const { Events } = require('../../events');
const _ = require("lodash");
const RewindBuffer = require("../../rewind/rewind_buffer");
const EventEmitter = require('events').EventEmitter;

const INTERNAL_EVENTS = {
  SOURCE_RECEIVED: "SOURCE_RECEIVED"
};

/**
 * Stream is the componenent where that listeners connect to.
 * Loads data from rewind buffer and pushes them to clients
 */
module.exports = class Stream extends EventEmitter {
  constructor(key, opts, ctx) {
    super();

    // remove our max listener count
    this.setMaxListeners(0);

    this.ctx = ctx;
    this.logger = ctx.logger.child({
      component: `stream[${key}]`
    })

    this.key = key;
    this.opts = opts;

    this.StreamTitle = this.opts.metaTitle;
    this.StreamUrl = "";

    this._id_increment = 1;
    this._lmeta = {};

    // stats
    this._totalConnections = 0;
    this._totalKBytesSent = 0;

    this.metaFunc = (chunk) => {
      if (chunk.StreamTitle) {
        this.StreamTitle = chunk.StreamTitle;
      }
      if (chunk.StreamUrl) {
        return this.StreamUrl = chunk.StreamUrl;
      }
    };

    this.bufferFunc = c => this.rewindBuffer._insertBuffer(c);

    this.rewindBuffer = new RewindBuffer({
      seconds: opts.seconds,
      burst: opts.burst,
      logger: this.logger,
      station: key,
      onListen: this.recordListen.bind(this),
      onListenerDisconnect: this.disconnectListener.bind(this)
    })

    this.once(INTERNAL_EVENTS.SOURCE_RECEIVED, () => {
      this.source.on("meta", this.metaFunc);
      this.source.on("buffer", this.bufferFunc);
    });

    // now run configure...
    process.nextTick(() => {
      return this.configure(this.opts);
    });

    // -- Wait to Load Rewind Buffer -- #
    this.emit("_source_waiting");
    this._sourceInitializing = true;

    this._sourceInitT = setTimeout(() => {
      this._sourceInitializing = false;
      this.emit("_source_init");
      this.logger.debug("Sending _source_init after source timeout");
    }, 15 * 1000);

    this.once(INTERNAL_EVENTS.SOURCE_RECEIVED, () => {
      this.logger.debug("Stream source is incoming.");
      clearTimeout(this._sourceInitT);
      this._sourceInitializing = true;

      return this.source.getRewind((err, stream, req) => {
        if (err) {
          this.logger.error(`Source getRewind encountered an error: ${err}`, {
            error: err
          });
          this._sourceInitializing = false;
          this.emit("_source_init");
          this.logger.debug("Sending _source_init after load error");
          //@emit "rewind_loaded"
          return false;
        }
        return this.rewindBuffer.loadBuffer(stream, (err) => {
          this.logger.debug("Slave source loaded rewind buffer.");
          //req.end()
          this._sourceInitializing = false;
          this.emit("_source_init");
          return this.logger.debug("Sending _source_init after load success");
        });
      });
    });
  }

    //----------
  status() {
    return {
      ...this.rewindBuffer._rStatus(),
      key: this.key,
      listeners: this.listeners(),
      connections: this._totalConnections,
      kbytes_sent: this._totalKBytesSent
    };
  }

  //----------
  useSource(source) {
    if (this.source === source) {
      // short-circuit if this is already our source
      return true;
    }

    this.source = source;
    this.rewindBuffer._rConnectSource(this.source);
    this.emit(INTERNAL_EVENTS.SOURCE_RECEIVED);
  }

  //----------
  getStreamKey(cb) {
    // use manual stream key if provided as part of stream configuration,
    // to allow for AAC stream keys that can't be pulled out of a header
    if (this.opts.stream_key) {
      return cb(this.opts.stream_key);
    } else {
      if (this.source) {
        return this.source.getStreamKey(cb);
      } else {
        return this.once(INTERNAL_EVENTS.SOURCE_RECEIVED, () => {
          return this.source.getStreamKey(cb);
        });
      }
    }
  }

  //----------
  _once_source_loaded(cb) {
    if (this._sourceInitializing) {
      // wait for a source_init event
      this.logger.debug("_once_source_loaded is waiting for _source_init");
      return this.once("_source_init", () => {
        return typeof cb === "function" ? cb() : void 0;
      });
    } else {
      return typeof cb === "function" ? cb() : void 0;
    }
  }

  //----------
  configure(opts1) {
    var key;
    this.opts = opts1;
    // -- Preroll -- #
    this.logger.debug("Preroll settings are ", {
      preroll: this.opts.preroll
    });
    if ((this.opts.preroll != null) && this.opts.preroll !== "") {
      // create a Preroller connection
      key = (this.opts.preroll_key && this.opts.preroll_key !== "") ? this.opts.preroll_key : this.key;
      new Preroller(this, key, this.opts.preroll, this.opts.transcoder, this.opts.impression_delay, (err, pre) => {
        if (err) {
          this.logger.error(`Failed to create preroller: ${err}`);
          return false;
        }
        this.preroll = pre;
        return this.logger.debug("Preroller is created.");
      });
    }
    // -- Set up bufferSize poller -- #

    // We disconnect clients that have fallen too far behind on their
    // buffers. Buffer size can be configured via the "max_buffer" setting,
    // which takes bits
    this.logger.debug(`Stream's max buffer size is ${this.opts.max_buffer}`);
    if (this.buf_timer) {
      clearInterval(this.buf_timer);
      this.buf_timer = null;
    }
    this.buf_timer = setInterval(() => {
      var all_buf, id, l, ref, ref1, ref2;
      all_buf = 0;
      ref = this._lmeta;
      for (id in ref) {
        l = ref[id];
        all_buf += l.rewind._queuedBytes + ((ref1 = l.obj.socket) != null ? ref1.bufferSize : void 0);
        if ((l.rewind._queuedBytes || 0) + (((ref2 = l.obj.socket) != null ? ref2.bufferSize : void 0) || 0) > this.opts.max_buffer) {
          this.logger.debug("Connection exceeded max buffer size.", {
            client: l.obj.client,
            bufferSize: l.rewind._queuedBytes
          });
          l.obj.disconnect(true);
        }
      }
      return this.logger.debug(`All buffers: ${all_buf}`);
    }, 60 * 1000);

    // Update RewindBuffer settings
    this.rewindBuffer.setRewind(this.opts.seconds, this.opts.burst);
    return this.emit("config");
  }

  //----------
  disconnect() {
    var k, l, ref, ref1, ref2;
    ref = this._lmeta;
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

  //----------
  listeners() {
    return _(this._lmeta).keys().length;
  }

  //----------
  listen(obj, opts, cb) {
    var lmeta;
    // generate a metadata hash
    lmeta = {
      id: this._id_increment++,
      obj: obj,
      startTime: opts.startTime || (new Date())
    };
    // each listen is a connection
    this._totalConnections += 1;
    // inject stream config into our options
    opts = _.extend({
      logInterval: this.opts.log_interval
    }, opts);
    // don't ask for a rewinder while our source is going through init,
    // since we don't want to fail an offset request that should be
    // valid.
    return this._once_source_loaded(() => {
      // get a rewinder (handles the actual broadcast)
      return this.rewindBuffer.getRewinder(lmeta.id, opts, (err, rewind, ...extra) => {
        if (err) {
          if (typeof cb === "function") {
            cb(err, null);
          }
          return false;
        }
        lmeta.rewind = rewind;
        // stash the object
        this._lmeta[lmeta.id] = lmeta;
        return typeof cb === "function" ? cb(null, lmeta.rewind, ...extra) : void 0;
      });
    });
  }

  //----------
  disconnectListener(id) {
    var lmeta;
    if (lmeta = this._lmeta[id]) {
      // -- remove from listeners -- #
      delete this._lmeta[id];
      return true;
    } else {
      return console.error(`disconnectListener called for ${id}, but no listener found.`);
    }
  }

  //----------

    // Log a partial listening segment
  recordListen(opts) {
    var lmeta, nothing;
    if (opts.bytes) {
      // temporary conversion support...
      opts.kbytes = Math.floor(opts.bytes / 1024);
    }
    if (_.isNumber(opts.kbytes)) {
      this._totalKBytesSent += opts.kbytes;
    }
    if (lmeta = this._lmeta[opts.id]) {
      this.ctx.events.emit(Events.Listener.LISTEN, {
        stream: this.key,
        type: "listen",
        client: lmeta.obj.client,
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

};

//----------
