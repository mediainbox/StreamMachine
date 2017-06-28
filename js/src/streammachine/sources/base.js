var Debounce, FrameChunker, Source, nconf, uuid,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

uuid = require("node-uuid");

nconf = require("nconf");

FrameChunker = require("./_frame_chunker");

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
      this.parserConstructor = require("../parsers/" + this.opts.format);
    }
  }

  Source.prototype.createParser = function() {
    var _ref;
    if ((_ref = this.log) != null) {
      _ref.debug("Creating " + this.opts.format + " frames parser");
    }
    this.chunker = new FrameChunker(this.emitDuration * 1000);
    this.parser = new this.parserConstructor;
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
    return this.chunker.on("readable", (function(_this) {
      return function() {
        var chunk, _results;
        _results = [];
        while (chunk = _this.chunker.read()) {
          _results.push(_this.emit("_chunk", chunk));
        }
        return _results;
      };
    })(this));
  };

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
    var _ref, _ref1, _ref2, _ref3;
    if ((_ref = this.log) != null) {
      _ref.debug("Setting _isDisconnected");
    }
    this._isDisconnected = true;
    if ((_ref1 = this.chunker) != null) {
      _ref1.removeAllListeners();
    }
    if ((_ref2 = this.parser) != null) {
      _ref2.removeAllListeners();
    }
    return (_ref3 = this._pingData) != null ? _ref3.kill() : void 0;
  };

  return Source;

})(require("events").EventEmitter);

//# sourceMappingURL=base.js.map
