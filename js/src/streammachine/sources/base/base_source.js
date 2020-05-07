var BaseSource, Debounce, FrameChunker, nconf, uuid;

uuid = require("uuid");

nconf = require("nconf");

FrameChunker = require("./_frame_chunker");

Debounce = require("../../util/debounce");

module.exports = BaseSource = class BaseSource extends require("events").EventEmitter {
  //----------
  constructor(opts, source_opts = {}) {
    var ref;
    super();
    this.opts = opts;
    this.uuid = this.opts.uuid || uuid.v4();
    this.connectedAt = this.opts.connectedAt || new Date();
    this._shouldHandoff = false;
    this._isDisconnected = false;
    this.isFallback = false;
    this.streamKey = null;
    this._vitals = null;
    this._chunk_queue = [];
    this._chunk_queue_ts = null;
    // How often will we emit chunks of data? The default is set in StreamMachine.Defaults
    this.emitDuration = this.opts.chunkDuration || (nconf.get("chunk_duration") && Number(nconf.get("chunk_duration"))) || 0.5;
    this.log = (ref = this.opts.logger) != null ? ref.child({
      uuid: this.uuid
    }) : void 0;
    if (source_opts.useHeartbeat) {
      // -- Alert if data stops flowing -- #

      // creates a sort of dead mans switch that we use to kill the connection
      // if it stops sending data
      this._pingData = new Debounce(this.opts.heartbeatTimeout || 30 * 1000, (last_ts) => {
        var ref1;
        if (!this._isDisconnected) {
          // data has stopped flowing. kill the connection.
          if ((ref1 = this.log) != null) {
            ref1.info("Source data stopped flowing.  Killing connection.");
          }
          this.emit("_source_dead", last_ts, Number(new Date()));
          return this.disconnect();
        }
      });
    }
    if (!source_opts.skipParser) {
      this.parserConstructor = require(`../../parsers/${this.opts.format}`);
    }
  }

  //----------
  createParser() {
    var ref;
    if ((ref = this.log) != null) {
      ref.debug(`create frames parser for format ${this.opts.format}`);
    }
    // -- Turns data frames into chunks -- #
    this.chunker = new FrameChunker(this.emitDuration * 1000);
    this.parser = new this.parserConstructor();
    // -- Pull vitals from first header -- #
    this.parser.once("header", (header) => {
      var ref1, ref2;
      // -- compute frames per second and stream key -- #
      this.framesPerSec = header.frames_per_sec;
      this.streamKey = header.stream_key;
      if ((ref1 = this.log) != null) {
        ref1.debug("setting framesPerSec to ", {
          frames: this.framesPerSec
        });
      }
      if ((ref2 = this.log) != null) {
        ref2.debug("first header received", header);
      }
      // -- send out our stream vitals -- #
      return this._setVitals({
        streamKey: this.streamKey,
        framesPerSec: this.framesPerSec,
        emitDuration: this.emitDuration
      });
    });
    this.parser.on("frame", (frame, header) => {
      var ref1;
      if ((ref1 = this._pingData) != null) {
        ref1.ping(); // heartbeat?
      }
      return this.chunker.write({
        frame: frame,
        header: header
      });
    });
    return this.chunker.on("readable", () => {
      var chunk, results;
      results = [];
      while (chunk = this.chunker.read()) {
        results.push(this.emit("_chunk", chunk));
      }
      return results;
    });
  }

  //----------
  getStreamKey(cb) {
    if (this.streamKey) {
      return typeof cb === "function" ? cb(this.streamKey) : void 0;
    } else {
      return this.once("vitals", () => {
        return typeof cb === "function" ? cb(this._vitals.streamKey) : void 0;
      });
    }
  }

  //----------
  _setVitals(vitals) {
    this._vitals = vitals;
    return this.emit("vitals", this._vitals);
  }

  //----------
  vitals(cb) {
    var _vFunc;
    _vFunc = (v) => {
      return typeof cb === "function" ? cb(null, v) : void 0;
    };
    if (this._vitals) {
      return _vFunc(this._vitals);
    } else {
      return this.once("vitals", _vFunc);
    }
  }

  //----------
  disconnect(cb) {
    var ref, ref1, ref2, ref3;
    if ((ref = this.log) != null) {
      ref.debug("Setting _isDisconnected");
    }
    this._isDisconnected = true;
    if ((ref1 = this.chunker) != null) {
      ref1.removeAllListeners();
    }
    if ((ref2 = this.parser) != null) {
      ref2.removeAllListeners();
    }
    return (ref3 = this._pingData) != null ? ref3.kill() : void 0;
  }

};

//----------

//# sourceMappingURL=base_source.js.map
