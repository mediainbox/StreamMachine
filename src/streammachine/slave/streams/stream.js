const { Events, BetterEventEmitter } = require('../../events');
const _ = require("lodash");
const RewindBuffer = require("../../rewind/rewind_buffer");
const Collection = require('../../util/collection');
const SocketSource = require("../streams/socket_source");

const INTERNAL_EVENTS = {
  SOURCE_INIT: "SOURCE_INIT",
  CONFIG: "CONFIG"
};

/**
 * Stream is the componenent where that listeners connect to.
 * Loads data from rewind buffer and pushes them to clients
 */
module.exports = class Stream extends BetterEventEmitter {
  key = '';
  config = {};
  metadata = {
    title: null,
    url: null,
  };
  stats = {
    connections: 0,
    kbytesSent: 0,
  };
  vitals = null;

  nextListenerId = 1;
  listeners = new Collection();

  constructor({ key, config, masterConnection, ctx }) {
    super();

    // remove our max listener count
    this.setMaxListeners(0);

    this.masterConnection = masterConnection;
    this.ctx = ctx;
    this.logger = ctx.logger.child({
      component: `stream[${key}]`
    })

    this.key = key;
    this.config = config;
    this.metadata.title = this.config.metaTitle;

    // rewind buffer associated to this stream
    this.rewindBuffer = new RewindBuffer({
      seconds: config.seconds,
      burst: config.burst,
      logger: this.logger,
      station: key,
      onListen: this.recordListen.bind(this),
      onListenerDisconnect: this.disconnectListener.bind(this)
    });

    this.hookEvents();
    this.configure();


    // socket source connects to master via websockets and
    // emits chunks for this stream
    this.source = new SocketSource({
      key,
      connection: this.masterConnection,
      ctx: this.ctx
    });

    // wait for vitals to connect !
    // this.rewindBuffer._rConnectSource(this.source);
  }

  hookEvents() {

    this.ctx.events.on(`audio:${this.key}`, (chunk) => {
      return this.emit("data", chunk);
    });

    this.source.on("meta", this.updateMetadataFromChunk);
    this.source.on("buffer", this.handleNewChunk);

    this.loadBufferFromSource();
  }

  loadBufferFromSource() {
    this.source.getRewind((err, stream, req) => {
      if (err) {
        this.logger.error(`Source getRewind encountered an error: ${err}`, {
          error: err
        });
        this.emit(INTERNAL_EVENTS.SOURCE_INIT);
        this.logger.debug("Sending _source_init after load error");
        return false;
      }

      return this.rewindBuffer.loadBuffer(stream, (err) => {
        this.logger.debug("Slave source loaded rewind buffer.");
        this.emit(INTERNAL_EVENTS.SOURCE_INIT);
        return this.logger.debug("Sending _source_init after load success");
      });
    });
  }

  updateMetadataFromChunk = (chunk) => {
    if (chunk.StreamTitle) {
      this.metadata.title = chunk.StreamTitle;
    }
    if (chunk.StreamUrl) {
      return this.metadata.url = chunk.StreamUrl;
    }
  };

  handleNewChunk = (chunk) => {
    this.rewindBuffer._insertBuffer(chunk)
  }

  status() {
    return {
      ...this.rewindBuffer._rStatus(),
      key: this.key,
      listeners: this.listeners.count(),
      connections: this.stats.connections,
      kbytes_sent: this.stats.kbytesSent
    };
  }

  configure() {
    // -- Set up bufferSize poller -- #
    // We disconnect clients that have fallen too far behind on their
    // buffers. Buffer size can be configured via the "max_buffer" setting,
    // which takes bits
    this.logger.debug(`stream max buffer size is ${this.config.max_buffer}`);


    this.listenersCleanup();

    // Update RewindBuffer settings
    this.rewindBuffer.setRewind(this.config.seconds, this.config.burst);

    this.connection.getStreamVitals(this.key, (err, vitals) => {
      this.logger.info('received vitals from master', { vitals });
      this.vitals = vitals;
    });
  }

  listenersCleanup() {

    if (this.buf_timer) {
      clearInterval(this.buf_timer);
      this.buf_timer = null;
    }

    this.buf_timer = setInterval(() => {
      let totalBufferSize = 0;

      this.listeners.toArray().map(listener => {
        const bufferSize = _.get(listener, 'obj.socket.bufferSize') || 0;
        const queuedBytes = _.get(listener, 'rewind._queuedBytes') || 0;

        const listenerBuffer = bufferSize + queuedBytes;
        totalBufferSize += listenerBuffer;

        if (listenerBuffer > this.config.max_buffer) {
          this.logger.debug("Connection exceeded max buffer size.", {
            client: listener.obj.client,
            bufferSize: listener.rewind._queuedBytes
          });
          listener.obj.disconnect(true);
        }
      })

      return this.logger.debug(`sum of all queued listeners buffers size: ${totalBufferSize}`);
    }, 60 * 1000);
  }

  //----------
  disconnect() {
    var k, l, ref, ref1, ref2;
    ref = this.listeners;
    for (k in ref) {
      l = ref[k];
      // handle clearing out lmeta
      l.obj.disconnect(true);
    }
    if (this.buf_timer) {
      clearInterval(this.buf_timer);
      this.buf_timer = null;
    }
    if ((ref1 = this.source) != null) {
      ref1.removeListener("meta", this.metaFunc);
    }
    if ((ref2 = this.source) != null) {
      ref2.removeListener("buffer", this.bufferFunc);
    }
    this.source = null;
    this.metaFunc = this.bufferFunc = function() {};
    this.rewindBuffer.disconnect();
    this.emit("disconnect");
    return this.removeAllListeners();
  }

  listen(obj, opts, cb) {
    // obj = output
    // opts = {
    //   offsetSecs
    //   offset
    //   pump
    //   startTime
    // }

    // generate a metadata hash
    const listener = {
      id: this.nextListenerId++,
      obj: obj,
      startTime: opts.startTime || (new Date())
    };
    // each listen is a connection
    this.stats.connections += 1;
    // inject stream config into our options
    opts = _.extend({
      logInterval: this.config.log_interval
    }, opts);
    // don't ask for a rewinder while our source is going through init,
    // since we don't want to fail an offset request that should be
    // valid.
    return this.runOrWait(INTERNAL_EVENTS.SOURCE_INIT, () => {
      // get a rewinder (handles the actual broadcast)
      return this.rewindBuffer.getRewinder(listener.id, opts, (err, rewind, ...extra) => {
        if (err) {
          if (typeof cb === "function") {
            cb(err, null);
          }
          return false;
        }
        listener.rewind = rewind;

        // stash the object
        this.listeners.add(listener.id, listener);
        return typeof cb === "function" ? cb(null, listener.rewind, ...extra) : void 0;
      });
    });
  }

  //----------
  disconnectListener(id) {
    const listener = this.listeners.remove(id);

    if (!listener) {
      console.error(`disconnectListener called for ${id}, but no listener found.`);
    }
  }


    // Log a partial listening segment
  recordListen(opts) {
    var lmeta, nothing;
    if (opts.bytes) {
      // temporary conversion support...
      opts.kbytes = Math.floor(opts.bytes / 1024);
    }
    if (_.isNumber(opts.kbytes)) {
      this.stats.kbytesSent += opts.kbytes;
    }

    const listener = this.listeners.get(opts.id);
    if (listener) {
      this.ctx.events.emit(Events.Listener.LISTEN, {
        stream: this.key,
        type: "listen",
        client: listener.obj.client,
        time: new Date(),
        kbytes: opts.kbytes,
        duration: opts.seconds,
        offsetSeconds: opts.offsetSeconds,
        contentTime: opts.contentTime
      });
    }
  }

  //----------
  startSession(client, cb) {
    this.ctx.events.emit(Events.Listener.SESSION_START, {
      type: "session_start",
      client: client,
      time: new Date(),
      session_id: client.session_id,
      stream: this.key
    });

    return cb(null, client.session_id);
  }

  getRewind(cb) {
    var gRT, req;
    // connect to the master's StreamTransport and ask for any rewind
    // buffer that is available
    gRT = setTimeout(() => {
      this.logger.debug("Failed to get rewind buffer response.");
      return typeof cb === "function" ? cb("Failed to get a rewind buffer response.") : void 0;
    }, 15000);
    // connect to: @master.options.host:@master.options.port

    // GET request for rewind buffer
    this.logger.debug(`Making Rewind Buffer request for ${this.key}`, {
      sock_id: this.connection.id
    });
    req = http.request({
      hostname: this.connection.io.io.opts.host,
      port: this.connection.io.io.opts.port,
      path: `/s/${this.key}/rewind`,
      headers: {
        'stream-slave-id': this.connection.id
      }
    }, (res) => {
      clearTimeout(gRT);
      this.logger.debug(`Got Rewind response with status code of ${res.statusCode}`);
      if (res.statusCode === 200) {
        return typeof cb === "function" ? cb(null, res) : void 0;
      } else {
        return typeof cb === "function" ? cb("Rewind request got a non-500 response.") : void 0;
      }
    });
    req.on("error", (err) => {
      clearTimeout(gRT);
      this.logger.debug(`Rewind request got error: ${err}`, {
        error: err
      });
      return typeof cb === "function" ? cb(err) : void 0;
    });
    return req.end();
  }


};

//----------
