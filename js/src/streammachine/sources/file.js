var FileSource, fs, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

fs = require("fs");

_ = require("underscore");

module.exports = FileSource = (function(_super) {
  __extends(FileSource, _super);

  FileSource.prototype.TYPE = function() {
    return "File (" + this.opts.filePath + ")";
  };

  function FileSource(opts) {
    this.opts = opts;
    FileSource.__super__.constructor.call(this);
    this.connected = false;
    this._file = null;
    this._chunks = [];
    this._emit_pos = 0;
    this._last_ts = Number(this.opts.ts) || null;
    if (!this.opts.do_not_emit) {
      this.start();
    }
    this.on("_chunk", (function(_this) {
      return function(chunk) {
        return _this._chunks.push(chunk);
      };
    })(this));
    this.createParser();
    this.parser.once("header", (function(_this) {
      return function(header) {
        _this.connected = true;
        return _this.emit("connect");
      };
    })(this));
    this.parser.once("end", (function(_this) {
      return function() {
        _this.parser.removeAllListeners();
        _this._current_chunk = null;
        return _this.emit("_loaded");
      };
    })(this));
    this._file = fs.createReadStream(this.opts.filePath);
    this._file.pipe(this.parser);
  }

  FileSource.prototype.start = function() {
    if (this._int) {
      return true;
    }
    this._int = setInterval((function(_this) {
      return function() {
        return _this._emitOnce();
      };
    })(this), this.emitDuration * 1000);
    this._emitOnce();
    return true;
  };

  FileSource.prototype.stop = function() {
    if (!this._int) {
      return true;
    }
    clearInterval(this._int);
    this._int = null;
    return true;
  };

  FileSource.prototype.emitSeconds = function(secs, wait, cb) {
    var count, emits, _f;
    if (_.isFunction(wait)) {
      cb = wait;
      wait = null;
    }
    emits = Math.ceil(secs / this.emitDuration);
    count = 0;
    if (wait) {
      _f = (function(_this) {
        return function() {
          _this._emitOnce();
          count += 1;
          if (count < emits) {
            return setTimeout(_f, wait);
          } else {
            return cb();
          }
        };
      })(this);
      return _f();
    } else {
      _f = (function(_this) {
        return function() {
          _this._emitOnce();
          count += 1;
          if (count < emits) {
            return process.nextTick(function() {
              return _f();
            });
          } else {
            return cb();
          }
        };
      })(this);
      return _f();
    }
  };

  FileSource.prototype._emitOnce = function(ts) {
    var chunk;
    if (ts == null) {
      ts = null;
    }
    if (this._emit_pos >= this._chunks.length) {
      this._emit_pos = 0;
    }
    chunk = this._chunks[this._emit_pos];
    if (!chunk) {
      return;
    }
    if (!chunk.data) {
      console.log("NO DATA!!!! ", chunk);
    }
    ts = this._last_ts ? this._last_ts + chunk.duration : Number(new Date());
    this.emit("data", {
      data: chunk.data,
      ts: new Date(ts),
      duration: chunk.duration,
      streamKey: this.streamKey,
      uuid: this.uuid
    });
    this._last_ts = ts;
    return this._emit_pos = this._emit_pos + 1;
  };

  FileSource.prototype.status = function() {
    var _ref;
    return {
      source: (_ref = typeof this.TYPE === "function" ? this.TYPE() : void 0) != null ? _ref : this.TYPE,
      uuid: this.uuid,
      filePath: this.filePath
    };
  };

  FileSource.prototype.disconnect = function() {
    if (this.connected) {
      this.connected = false;
      this.emit("disconnect");
      return clearInterval(this._int);
    }
  };

  return FileSource;

})(require("./base"));

//# sourceMappingURL=file.js.map
