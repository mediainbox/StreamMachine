var BaseOutput, Pumper, debug,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

BaseOutput = require("./base");

debug = require("debug")("sm:outputs:pumper");

module.exports = Pumper = (function(_super) {
  __extends(Pumper, _super);

  function Pumper(stream, opts) {
    this.stream = stream;
    this.opts = opts;
    Pumper.__super__.constructor.call(this, "pumper");
    this.stream.listen(this, {
      offsetSecs: this.opts.req.query.from || this.opts.req.query.pump,
      pump: this.opts.req.query.pump,
      pumpOnly: true
    }, (function(_this) {
      return function(err, source, info) {
        var headers;
        _this.source = source;
        if (err) {
          _this.opts.res.status(500).end(err);
          return false;
        }
        headers = {
          "Content-Type": _this.stream.opts.format === "mp3" ? "audio/mpeg" : _this.stream.opts.format === "aac" ? "audio/aacp" : "unknown",
          "Connection": "close",
          "Content-Length": info.length
        };
        _this.opts.res.writeHead(200, headers);
        _this.source.pipe(_this.opts.res);
        _this.socket.on("end", function() {
          return _this.disconnect();
        });
        _this.socket.on("close", function() {
          return _this.disconnect();
        });
        return _this.socket.on("error", function(err) {
          _this.stream.log.debug("Got client socket error: " + err);
          return _this.disconnect();
        });
      };
    })(this));
  }

  Pumper.prototype.disconnect = function() {
    return Pumper.__super__.disconnect.call(this, (function(_this) {
      return function() {
        var _ref, _ref1;
        if ((_ref = _this.source) != null) {
          _ref.disconnect();
        }
        if (!_this.socket.destroyed) {
          return (_ref1 = _this.socket) != null ? _ref1.end() : void 0;
        }
      };
    })(this));
  };

  return Pumper;

})(BaseOutput);

//# sourceMappingURL=pumper.js.map
