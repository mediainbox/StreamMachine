var Preroller, Rewind, Stream, _, debug, uuid;

_ = require("underscore");

uuid = require("node-uuid");

Preroller = require("./preroller");

Rewind = require("../rewind_buffer");

debug = require("debug")("sm:slave:stream");

// Streams are the endpoints that listeners connect to.

// On startup, a slave stream should connect to the master and start serving
// live audio as quickly as possible. It should then try to load in any
// Rewind buffer info available on the master.
module.exports = Stream = (function() {
  class Stream extends require('../rewind_buffer') {
    constructor(core, key1, log, opts) {
      super({
        seconds: opts.seconds,
        burst: opts.burst
      });
      this.core = core;
      this.key = key1;
      this.log = log;
      this.opts = opts;
      this.STATUS = "Initializing";
      this.StreamTitle = this.opts.metaTitle;
      this.StreamUrl = "";
      // remove our max listener count
      this.setMaxListeners(0);
      this._id_increment = 1;
      this._lmeta = {};
      this.preroll = null;
      this.mlog_timer = null;
      // -- Stats Counters -- #
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
      this.bufferFunc = (c) => {
        return this._insertBuffer(c);
      };
      this.once("source", () => {
        this.source.on("meta", this.metaFunc);
        return this.source.on("buffer", this.bufferFunc);
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
        return debug("Sending _source_init after source timeout");
      }, 15 * 1000);
      this.once("source", (source) => {
        debug("Stream source is incoming.");
        clearTimeout(this._sourceInitT);
        this._sourceInitializing = true;
        return source.getRewind((err, stream, req) => {
          if (err) {
            this.log.error(`Source getRewind encountered an error: ${err}`, {
              error: err
            });
            this._sourceInitializing = false;
            this.emit("_source_init");
            debug("Sending _source_init after load error");
            //@emit "rewind_loaded"
            return false;
          }
          return this.loadBuffer(stream, (err) => {
            this.log.debug("Slave source loaded rewind buffer.");
            //req.end()
            this._sourceInitializing = false;
            this.emit("_source_init");
            return debug("Sending _source_init after load success");
          });
        });
      });
    }

    //@emit "rewind_loaded"

      //----------
    status() {
      return _.extend(this._rStatus(), {
        key: this.key,
        listeners: this.listeners(),
        connections: this._totalConnections,
        kbytes_sent: this._totalKBytesSent
      });
    }

    //----------
    useSource(source) {
      if (this.source === source) {
        // short-circuit if this is already our source
        return true;
      }
      this.log.debug("Slave stream got source connection");
      this.source = source;
      return this.emit("source", this.source);
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
          return this.once("source", () => {
            return this.source.getStreamKey(cb);
          });
        }
      }
    }

    //----------
    _once_source_loaded(cb) {
      if (this._sourceInitializing) {
        // wait for a source_init event
        debug("_once_source_loaded is waiting for _source_init");
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
      this.log.debug("Preroll settings are ", {
        preroll: this.opts.preroll
      });
      if ((this.opts.preroll != null) && this.opts.preroll !== "") {
        // create a Preroller connection
        key = (this.opts.preroll_key && this.opts.preroll_key !== "") ? this.opts.preroll_key : this.key;
        new Preroller(this, key, this.opts.preroll, this.opts.transcoder, this.opts.impression_delay, (err, pre) => {
          if (err) {
            this.log.error(`Failed to create preroller: ${err}`);
            return false;
          }
          this.preroll = pre;
          return this.log.debug("Preroller is created.");
        });
      }
      // -- Set up bufferSize poller -- #

      // We disconnect clients that have fallen too far behind on their
      // buffers. Buffer size can be configured via the "max_buffer" setting,
      // which takes bits
      this.log.debug(`Stream's max buffer size is ${this.opts.max_buffer}`);
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
            this.log.debug("Connection exceeded max buffer size.", {
              client: l.obj.client,
              bufferSize: l.rewind._queuedBytes
            });
            l.obj.disconnect(true);
          }
        }
        return this.log.debug(`All buffers: ${all_buf}`);
      }, 60 * 1000);
      // Update RewindBuffer settings
      this.setRewind(this.opts.seconds, this.opts.burst);
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
      super.disconnect();
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
        return this.getRewinder(lmeta.id, opts, (err, rewind, ...extra) => {
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
        return nothing = 1;
      }
    }

    /*
    @log.interaction "",
        type:           "listen"
        client:         lmeta.obj.client
        time:           new Date()
        kbytes:         opts.kbytes
        duration:       opts.seconds
        offsetSeconds:  opts.offsetSeconds
        contentTime:    opts.contentTime
    */
    //----------
    startSession(client, cb) {
      /*
      @log.interaction "",
          type:       "session_start"
          client:     client
          time:       new Date()
          session_id: client.session_id
      */
      return cb(null, client.session_id);
    }

  };

  //----------
  Stream.StreamGroup = class StreamGroup extends require("events").EventEmitter {
    constructor(key1, log) {
      super();
      this.key = key1;
      this.log = log;
      this.streams = {};
    }

    //----------
    addStream(stream) {
      var delFunc;
      if (!this.streams[stream.key]) {
        this.log.debug(`SG ${this.key}: Adding stream ${stream.key}`);
        this.streams[stream.key] = stream;
        // listen in case it goes away
        delFunc = () => {
          this.log.debug(`SG ${this.key}: Stream disconnected: ${stream.key}`);
          return delete this.streams[stream.key];
        };
        stream.on("disconnect", delFunc);
        return stream.on("config", () => {
          if (stream.opts.group !== this.key) {
            return delFunc();
          }
        });
      }
    }

    //----------
    startSession(client, cb) {
      /*
      @log.interaction "",
          type:       "session_start"
          client:     client
          time:       new Date()
          id:         client.session_id
      */
      return cb(null, client.session_id);
    }

  };

  return Stream;

}).call(this);

//# sourceMappingURL=stream.js.map
