var BaseOutput, Icy, Shoutcast, debug, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require('underscore');

Icy = require("icy");

BaseOutput = require("./base");

debug = require("debug")("sm:outputs:shoutcast");

module.exports = Shoutcast = (function(_super) {
  __extends(Shoutcast, _super);

  function Shoutcast(stream, opts) {
    this.stream = stream;
    this.opts = opts;
    this.disconnected = false;
    this.id = null;
    Shoutcast.__super__.constructor.call(this, "shoutcast");
    this.pump = true;
    this._lastMeta = null;
    if (this.opts.req && this.opts.res) {
      debug("Incoming Request Headers: ", this.opts.req.headers);
      this.client.offsetSecs = this.opts.req.query.offset || -1;
      this.client.meta_int = this.stream.opts.meta_interval;
      this.opts.res.chunkedEncoding = false;
      this.opts.res.useChunkedEncodingByDefault = false;
      this.headers = {
        "Content-Type": this.stream.opts.format === "mp3" ? "audio/mpeg" : this.stream.opts.format === "aac" ? "audio/aacp" : "unknown",
        "icy-name": this.stream.StreamTitle,
        "icy-url": this.stream.StreamUrl,
        "icy-metaint": this.client.meta_int,
        "Accept-Ranges": "none"
      };
      this.opts.res.writeHead(200, this.headers);
      this.opts.res._send('');
      this.stream.startSession(this.client, (function(_this) {
        return function(err, session_id) {
          debug("Incoming connection given session_id of " + session_id);
          _this.client.session_id = session_id;
          return process.nextTick(function() {
            return _this._startAudio(true);
          });
        };
      })(this));
    } else if (this.opts.socket) {
      this.pump = false;
      process.nextTick((function(_this) {
        return function() {
          return _this._startAudio(false);
        };
      })(this));
    }
    this.socket.on("end", (function(_this) {
      return function() {
        return _this.disconnect();
      };
    })(this));
    this.socket.on("close", (function(_this) {
      return function() {
        return _this.disconnect();
      };
    })(this));
    this.socket.on("error", (function(_this) {
      return function() {
        return _this.disconnect();
      };
    })(this));
  }

  Shoutcast.prototype._startAudio = function(initial) {
    this.ice = new Icy.Writer(this.client.bytesToNextMeta || this.client.meta_int);
    this.ice.metaint = this.client.meta_int;
    delete this.client.bytesToNextMeta;
    this.ice.pipe(this.socket);
    if (initial && this.stream.preroll && !this.opts.req.query.preskip) {
      debug("Pumping preroll");
      return this.stream.preroll.pump(this, this.ice, (function(_this) {
        return function(err) {
          debug("Back from preroll. Connecting to stream.");
          return _this.connectToStream();
        };
      })(this));
    } else {
      return this.connectToStream();
    }
  };

  Shoutcast.prototype.disconnect = function() {
    return Shoutcast.__super__.disconnect.call(this, (function(_this) {
      return function() {
        var _ref, _ref1, _ref2, _ref3;
        if ((_ref = _this.ice) != null) {
          _ref.unpipe();
        }
        if ((_ref1 = _this.source) != null) {
          _ref1.disconnect();
        }
        if (!((_ref2 = _this.socket) != null ? _ref2.destroyed : void 0)) {
          return (_ref3 = _this.socket) != null ? _ref3.end() : void 0;
        }
      };
    })(this));
  };

  Shoutcast.prototype.prepForHandoff = function(cb) {
    this.client.bytesToNextMeta = this.ice._parserBytesLeft;
    delete this.client.offsetSecs;
    return typeof cb === "function" ? cb() : void 0;
  };

  Shoutcast.prototype.connectToStream = function() {
    if (!this.disconnected) {
      return this.stream.listen(this, {
        offsetSecs: this.client.offsetSecs,
        offset: this.client.offset,
        pump: this.pump,
        startTime: this.opts.startTime
      }, (function(_this) {
        return function(err, source) {
          var _ref;
          _this.source = source;
          if (err) {
            if (_this.opts.res != null) {
              _this.opts.res.status(500).end(err);
            } else {
              if ((_ref = _this.socket) != null) {
                _ref.end();
              }
            }
            return false;
          }
          _this.client.offset = _this.source.offset();
          _this.source.onFirstMeta(function(err, meta) {
            if (meta) {
              return _this.ice.queue(meta);
            }
          });
          _this.metaFunc = function(data) {
            if (!(_this._lastMeta && _(data).isEqual(_this._lastMeta))) {
              _this.ice.queue(data);
              return _this._lastMeta = data;
            }
          };
          _this.source.pipe(_this.ice);
          return _this.source.on("meta", _this.metaFunc);
        };
      })(this));
    }
  };

  return Shoutcast;

})(BaseOutput);

//# sourceMappingURL=shoutcast.js.map
