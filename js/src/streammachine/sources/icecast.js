var IcecastSource,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

module.exports = IcecastSource = (function(_super) {
  __extends(IcecastSource, _super);

  IcecastSource.prototype.TYPE = function() {
    return "Icecast (" + ([this.opts.source_ip, this.opts.sock.remotePort].join(":")) + ")";
  };

  IcecastSource.prototype.HANDOFF_TYPE = "icecast";

  function IcecastSource(opts) {
    var _ref;
    this.opts = opts;
    IcecastSource.__super__.constructor.call(this, {
      useHeartbeat: true
    });
    this._shouldHandoff = true;
    if ((_ref = this.log) != null) {
      _ref.debug("New Icecast source.");
    }
    this._vtimeout = setTimeout((function(_this) {
      return function() {
        var _ref1;
        if ((_ref1 = _this.log) != null) {
          _ref1.error("Failed to get source vitals before timeout. Forcing disconnect.");
        }
        return _this.disconnect();
      };
    })(this), 3000);
    this.once("vitals", (function(_this) {
      return function() {
        var _ref1;
        if ((_ref1 = _this.log) != null) {
          _ref1.debug("Vitals parsed for source.");
        }
        clearTimeout(_this._vtimeout);
        return _this._vtimeout = null;
      };
    })(this));
    this.createParser();
    this.opts.sock.pipe(this.parser);
    this.last_ts = null;
    this.on("_chunk", function(chunk) {
      this.last_ts = chunk.ts;
      return this.emit("data", chunk);
    });
    this.opts.sock.on("close", (function(_this) {
      return function() {
        var _ref1;
        if ((_ref1 = _this.log) != null) {
          _ref1.debug("Icecast source got close event");
        }
        return _this.disconnect();
      };
    })(this));
    this.opts.sock.on("end", (function(_this) {
      return function() {
        var _ref1;
        if ((_ref1 = _this.log) != null) {
          _ref1.debug("Icecast source got end event");
        }
        return _this.disconnect();
      };
    })(this));
    this.connected = true;
  }

  IcecastSource.prototype.status = function() {
    var _ref;
    return {
      source: (_ref = typeof this.TYPE === "function" ? this.TYPE() : void 0) != null ? _ref : this.TYPE,
      connected: this.connected,
      url: [this.opts.source_ip, this.opts.sock.remotePort].join(":"),
      streamKey: this.streamKey,
      uuid: this.uuid,
      last_ts: this.last_ts,
      connected_at: this.connectedAt
    };
  };

  IcecastSource.prototype.disconnect = function() {
    if (this.connected) {
      IcecastSource.__super__.disconnect.apply(this, arguments);
      if (this._vtimeout) {
        clearTimeout(this._vtimeout);
      }
      this.opts.sock.destroy();
      this.opts.sock.removeAllListeners();
      this.connected = false;
      this.emit("disconnect");
      return this.removeAllListeners();
    }
  };

  return IcecastSource;

})(require("./base"));

//# sourceMappingURL=icecast.js.map
