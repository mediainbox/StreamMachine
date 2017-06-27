var Icy, ProxySource, debug, domain, moment, url, util, _,
  __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

Icy = require('icy');

util = require('util');

url = require('url');

domain = require("domain");

moment = require("moment");

_ = require("underscore");

debug = require("debug")("sm:sources:proxy");

module.exports = ProxySource = (function(_super) {
  __extends(ProxySource, _super);

  ProxySource.prototype.TYPE = function() {
    return "Proxy (" + this.url + ")";
  };

  function ProxySource(opts) {
    this.opts = opts;
    this.reconnect = __bind(this.reconnect, this);
    this.checkStatus = __bind(this.checkStatus, this);
    this.broadcastData = __bind(this.broadcastData, this);
    this.connect = __bind(this.connect, this);
    this.status = __bind(this.status, this);
    this._niceError = __bind(this._niceError, this);
    ProxySource.__super__.constructor.call(this, {
      useHeartbeat: false
    });
    this.url = this.opts.url;
    debug("ProxySource created for " + this.url);
    this.isFallback = this.opts.fallback || false;
    this.defaultHeaders = this.opts.headers || {
      "user-agent": "StreamMachine 0.1.0"
    };
    this.connected = false;
    this.framesPerSec = null;
    this.connected_at = null;
    this._in_disconnect = false;
    this._maxBounces = 10;
    this._bounces = 0;
    this._bounceInt = 5;
    this.StreamTitle = null;
    this.StreamUrl = null;
    this.d = domain.create();
    this.d.on("error", (function(_this) {
      return function(err) {
        return _this._niceError(err);
      };
    })(this));
    this.d.run((function(_this) {
      return function() {
        return _this.connect();
      };
    })(this));
  }

  ProxySource.prototype._niceError = function(err) {
    var nice_err, _ref;
    debug("Caught error: " + err, err.stack);
    nice_err = (function() {
      switch (err.syscall) {
        case "getaddrinfo":
          return "Unable to look up DNS for Icecast proxy";
        case "connect":
          return "Unable to connect to Icecast proxy. Connection Refused";
        default:
          return "Error making connection to Icecast proxy";
      }
    })();
    return (_ref = this.log) != null ? _ref.error("ProxySource encountered an error: " + nice_err, err) : void 0;
  };

  ProxySource.prototype.status = function() {
    var _ref;
    return {
      source: (_ref = typeof this.TYPE === "function" ? this.TYPE() : void 0) != null ? _ref : this.TYPE,
      connected: this.connected,
      url: this.url,
      streamKey: this.streamKey,
      uuid: this.uuid,
      isFallback: this.isFallback,
      last_ts: this.last_ts,
      connected_at: this.connected_at
    };
  };

  ProxySource.prototype.connect = function() {
    var url_opts;
    debug("Begin connection to Icecast from " + this.url);
    url_opts = url.parse(this.url);
    url_opts.headers = _.clone(this.defaultHeaders);
    this.last_ts = null;
    this.chunker.resetTime(new Date());
    this.ireq = Icy.get(url_opts, (function(_this) {
      return function(ice) {
        debug("Connected to Icecast from " + _this.url);
        if (ice.statusCode === 302) {
          _this.url = ice.headers.location;
        }
        _this.icecast = ice;
        _this.icecast.once("end", function() {
          debug("Received Icecast END event");
          return _this.reconnect();
        });
        _this.icecast.once("close", function() {
          debug("Received Icecast CLOSE event");
          return _this.reconnect();
        });
        _this.icecast.on("metadata", function(data) {
          var meta;
          debug("Received Icecast METADATA event");
          if (!_this._in_disconnect) {
            meta = Icy.parse(data);
            if (meta.StreamTitle) {
              _this.StreamTitle = meta.StreamTitle;
            }
            if (meta.StreamUrl) {
              _this.StreamUrl = meta.StreamUrl;
            }
            return _this.emit("metadata", {
              StreamTitle: _this.StreamTitle || "",
              StreamUrl: _this.StreamUrl || ""
            });
          }
        });
        _this.icecast.on("data", function(chunk) {
          return _this.parser.write(chunk);
        });
        _this.connected = true;
        _this.connected_at = new Date();
        _this.emit("connect");
        return setTimeout(_this.checkStatus, 30000);
      };
    })(this));
    this.ireq.once("error", (function(_this) {
      return function(err) {
        _this._niceError(err);
        return _this.reconnect();
      };
    })(this));
    return this.on("_chunk", this.broadcastData);
  };

  ProxySource.prototype.broadcastData = function(chunk) {
    debug("Received chunk from parser (" + chunk.ts + ")");
    this.last_ts = chunk.ts;
    return this.emit("data", chunk);
  };

  ProxySource.prototype.checkStatus = function() {
    debug("Check status: last chunk timestamp is " + this.last_ts);
    if (!(this.connected && !this._in_disconnect)) {
      return;
    }
    if (!this.last_ts) {
      return setTimeout(this.checkStatus, 5000);
    }
    if (moment(this.last_ts).isBefore(moment().subtract(1, "minutes"))) {
      return this.reconnect();
    }
    return setTimeout(this.checkStatus, 30000);
  };

  ProxySource.prototype.reconnect = function() {
    var msWaitToConnect, _ref, _ref1, _ref2, _ref3;
    if (!(this._in_disconnect && !this.connected)) {
      msWaitToConnect = 5000;
      debug("Reconnect to Icecast source from " + this.url + " in " + msWaitToConnect + "ms");
      this.connected = false;
      this.removeListener("_chunk", this.broadcastData);
      if ((_ref = this.ireq) != null) {
        _ref.end();
      }
      if ((_ref1 = this.ireq) != null) {
        if ((_ref2 = _ref1.res) != null) {
          _ref2.client.destroy();
        }
      }
      if ((_ref3 = this.icecast) != null) {
        _ref3.removeAllListeners();
      }
      this.icecast = null;
      this.ireq = null;
      return setTimeout(this.connect, msWaitToConnect);
    }
  };

  ProxySource.prototype.disconnect = function() {
    var _ref;
    this._in_disconnect = true;
    if (this.connected) {
      if ((_ref = this.icecast) != null) {
        _ref.removeAllListeners();
      }
      this.parser.removeAllListeners();
      this.removeAllListeners();
      this.icecast.end();
      this.parser = null;
      this.icecast = null;
      debug("ProxySource disconnected.");
      return this.removeAllListeners();
    }
  };

  return ProxySource;

})(require("./base"));

//# sourceMappingURL=proxy.js.map
