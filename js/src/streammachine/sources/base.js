var Debounce, Source, nconf, uuid,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

uuid = require("node-uuid");

nconf = require("nconf");

Debounce = require("../util/debounce");

module.exports = Source = (function(_super) {
  __extends(Source, _super);

  function Source(source_opts) {
    var _ref;
    if (source_opts == null) {
      source_opts = {};
    }
    this.uuid = this.opts.uuid || uuid.v4();
    this.connectedAt = this.opts.connectedAt || new Date();
    this._shouldHandoff = false;
    this._isDisconnected = false;
    this.isFallback = false;
    this.streamKey = null;
    this._vitals = null;
    this._chunk_queue = [];
    this._chunk_queue_ts = null;
    this.emitDuration = this.opts.chunkDuration || (nconf.get("chunk_duration") && Number(nconf.get("chunk_duration"))) || 0.5;
    this.log = (_ref = this.opts.logger) != null ? _ref.child({
      uuid: this.uuid
    }) : void 0;
    this.parser = new (require("../parsers/" + this.opts.format));
    if (source_opts.useHeartbeat) {
      this._pingData = new Debounce(this.opts.heartbeatTimeout || 30 * 1000, (function(_this) {
        return function(last_ts) {
          var _ref1;
          if (!_this._isDisconnected) {
            if ((_ref1 = _this.log) != null) {
              _ref1.info("Source data stopped flowing.  Killing connection.");
            }
            _this.emit("_source_dead", last_ts, Number(new Date()));
            return _this.disconnect();
          }
        };
      })(this));
    }
    if (!source_opts.skipParser) {
      this.parser.once("header", (function(_this) {
        return function(header) {
          var _ref1, _ref2;
          _this.framesPerSec = header.frames_per_sec;
          _this.streamKey = header.stream_key;
          if ((_ref1 = _this.log) != null) {
            _ref1.debug("setting framesPerSec to ", {
              frames: _this.framesPerSec
            });
          }
          if ((_ref2 = _this.log) != null) {
            _ref2.debug("first header is ", header);
          }
          return _this._setVitals({
            streamKey: _this.streamKey,
            framesPerSec: _this.framesPerSec,
            emitDuration: _this.emitDuration
          });
        };
      })(this));
      this.chunker = new Source.FrameChunker(this.emitDuration * 1000);
      this.parser.on("frame", (function(_this) {
        return function(frame, header) {
          var _ref1;
          if ((_ref1 = _this._pingData) != null) {
            _ref1.ping();
          }
          return _this.chunker.write({
            frame: frame,
            header: header
          });
        };
      })(this));
      this.chunker.on("readable", (function(_this) {
        return function() {
          var c, _results;
          _results = [];
          while (c = _this.chunker.read()) {
            _results.push(_this.emit("_chunk", c));
          }
          return _results;
        };
      })(this));
    }
  }

  Source.prototype.getStreamKey = function(cb) {
    if (this.streamKey) {
      return typeof cb === "function" ? cb(this.streamKey) : void 0;
    } else {
      return this.once("vitals", (function(_this) {
        return function() {
          return typeof cb === "function" ? cb(_this._vitals.streamKey) : void 0;
        };
      })(this));
    }
  };

  Source.prototype._setVitals = function(vitals) {
    this._vitals = vitals;
    return this.emit("vitals", this._vitals);
  };

  Source.prototype.vitals = function(cb) {
    var _vFunc;
    _vFunc = (function(_this) {
      return function(v) {
        return typeof cb === "function" ? cb(null, v) : void 0;
      };
    })(this);
    if (this._vitals) {
      return _vFunc(this._vitals);
    } else {
      return this.once("vitals", _vFunc);
    }
  };

  Source.prototype.disconnect = function(cb) {
    var _ref, _ref1;
    if ((_ref = this.log) != null) {
      _ref.debug("Setting _isDisconnected");
    }
    this._isDisconnected = true;
    this.chunker.removeAllListeners();
    this.parser.removeAllListeners();
    return (_ref1 = this._pingData) != null ? _ref1.kill() : void 0;
  };

  Source.FrameChunker = (function(_super1) {
    __extends(FrameChunker, _super1);

    function FrameChunker(duration, initialTime) {
      this.duration = duration;
      this.initialTime = initialTime != null ? initialTime : new Date();
      this._chunk_queue = [];
      this._queue_duration = 0;
      this._remainders = 0;
      this._target = this.duration;
      this._last_ts = null;
      FrameChunker.__super__.constructor.call(this, {
        objectMode: true
      });
    }

    FrameChunker.prototype.resetTime = function(ts) {
      this._last_ts = null;
      this._remainders = 0;
      return this.initialTime = ts;
    };

    FrameChunker.prototype._transform = function(obj, encoding, cb) {
      var buf, duration, frames, len, o, simple_dur, simple_rem, ts, _i, _len, _ref;
      this._chunk_queue.push(obj);
      this._queue_duration += obj.header.duration;
      if (this._queue_duration > this._target) {
        this._target = this._target + (this.duration - this._queue_duration);
        len = 0;
        _ref = this._chunk_queue;
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          o = _ref[_i];
          len += o.frame.length;
        }
        frames = this._chunk_queue.length;
        buf = Buffer.concat((function() {
          var _j, _len1, _ref1, _results;
          _ref1 = this._chunk_queue;
          _results = [];
          for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
            o = _ref1[_j];
            _results.push(o.frame);
          }
          return _results;
        }).call(this));
        duration = this._queue_duration;
        this._chunk_queue.length = 0;
        this._queue_duration = 0;
        simple_dur = Math.floor(duration);
        this._remainders += duration - simple_dur;
        if (this._remainders > 1) {
          simple_rem = Math.floor(this._remainders);
          this._remainders = this._remainders - simple_rem;
          simple_dur += simple_rem;
        }
        ts = this._last_ts ? new Date(Number(this._last_ts) + simple_dur) : this.initialTime;
        this._last_ts = ts;
        this.push({
          data: buf,
          ts: ts,
          duration: duration,
          frames: frames,
          streamKey: obj.header.stream_key
        });
      }
      return cb();
    };

    return FrameChunker;

  })(require("stream").Transform);

  return Source;

})(require("events").EventEmitter);

//# sourceMappingURL=base.js.map
