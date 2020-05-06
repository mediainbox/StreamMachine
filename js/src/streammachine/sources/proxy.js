var Icy, ProxySource, _, debug, domain, moment, url, util,
  boundMethodCheck = function(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new Error('Bound instance method accessed before binding'); } };

Icy = require('icy');

util = require('util');

url = require('url');

domain = require("domain");

moment = require("moment");

_ = require("underscore");

debug = require("debug")("sm:sources:proxy");

module.exports = ProxySource = class ProxySource extends require("./base") {
  TYPE() {
    return `Proxy (${this.url})`;
  }

  // opts should include:
  // format:   Format for Parser (aac or mp3)
  // url:      URL for original stream
  // fallback: Should we set the isFallback flag? (default false)
  // logger:   Logger (optional)
  constructor(opts) {
    super(opts, {
      useHeartbeat: false
    });
    //----------
    this._niceError = this._niceError.bind(this);
    //----------
    this.status = this.status.bind(this);
    //----------
    this.connect = this.connect.bind(this);
    //----------
    this.broadcastData = this.broadcastData.bind(this);
    //----------
    this._logChunk = this._logChunk.bind(this);
    //----------
    this.checkStatus = this.checkStatus.bind(this);
    //----------
    this.reconnect = this.reconnect.bind(this);
    this.url = this.opts.url;
    debug(`ProxySource created for ${this.url}`);
    this.isFallback = this.opts.fallback || false;
    this.defaultHeaders = this.opts.headers || {
      "user-agent": "StreamMachine 0.1.0"
    };
    this.connected = false;
    this.framesPerSec = null;
    this.connected_at = null;
    this.chunksCount = 0;
    this._in_disconnect = false;
    // connection drop handling
    // (FIXME: bouncing not yet implemented)
    this._maxBounces = 10;
    this._bounces = 0;
    this._bounceInt = 5;
    this.StreamTitle = null;
    this.StreamUrl = null;
    this.d = domain.create();
    this.d.on("error", (err) => {
      return this._niceError(err);
    });
    this.d.run(() => {
      return this.connect();
    });
  }

  _niceError(err) {
    var nice_err, ref;
    boundMethodCheck(this, ProxySource);
    debug(`Caught error: ${err}`, err.stack);
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
    return (ref = this.log) != null ? ref.error(`ProxySource encountered an error: ${nice_err}`, err) : void 0;
  }

  status() {
    var ref;
    boundMethodCheck(this, ProxySource);
    return {
      source: (ref = typeof this.TYPE === "function" ? this.TYPE() : void 0) != null ? ref : this.TYPE,
      connected: this.connected,
      url: this.url,
      streamKey: this.streamKey,
      uuid: this.uuid,
      isFallback: this.isFallback,
      last_ts: this.last_ts,
      connected_at: this.connected_at
    };
  }

  connect() {
    var url_opts;
    boundMethodCheck(this, ProxySource);
    this.createParser();
    debug(`Begin connection to Icecast from ${this.url}`);
    url_opts = url.parse(this.url);
    url_opts.headers = _.clone(this.defaultHeaders);
    this.last_ts = null;
    this.chunker.resetTime(new Date());
    this.ireq = Icy.get(url_opts, (ice) => {
      debug(`Connected to Icecast from ${this.url}`);
      if (ice.statusCode === 302) {
        this.url = ice.headers.location;
      }
      this.icecast = ice;
      this.icecast.once("end", () => {
        debug("Received Icecast END event");
        return this.reconnect();
      });
      this.icecast.once("close", () => {
        debug("Received Icecast CLOSE event");
        return this.reconnect();
      });
      this.icecast.on("metadata", (data) => {
        var meta;
        debug("Received Icecast METADATA event");
        if (!this._in_disconnect) {
          meta = Icy.parse(data);
          if (meta.StreamTitle) {
            this.StreamTitle = meta.StreamTitle;
          }
          if (meta.StreamUrl) {
            this.StreamUrl = meta.StreamUrl;
          }
          return this.emit("metadata", {
            StreamTitle: this.StreamTitle || "",
            StreamUrl: this.StreamUrl || ""
          });
        }
      });
      // incoming -> Parser
      this.icecast.on("data", (chunk) => {
        return this.parser.write(chunk);
      });
      // return with success
      this.connected = true;
      this.connected_at = new Date();
      this.emit("connect");
      return setTimeout(this.checkStatus, 30000);
    });
    this.ireq.once("error", (err) => {
      debug(`Got icecast stream error ${err}, reconnecting`);
      this._niceError(err);
      return this.reconnect(true);
    });
    // outgoing -> Stream
    this.on("_chunk", this.broadcastData);
    this.logChunk = _.throttle(this._logChunk.bind(this), 5000);
    return this.on("_chunk", this.logChunk);
  }

  broadcastData(chunk) {
    boundMethodCheck(this, ProxySource);
    this.chunksCount++;
    this.last_ts = chunk.ts;
    return this.emit("data", chunk);
  }

  _logChunk(chunk) {
    boundMethodCheck(this, ProxySource);
    return debug(`received chunk from parser (time: ${chunk.ts.toISOString().substr(11)}, total: ${this.chunksCount})`);
  }

  checkStatus() {
    boundMethodCheck(this, ProxySource);
    if (!this.connected) {
      debug("Check status: not connected, skipping");
      return;
    }
    debug(`Check status: last chunk timestamp is ${this.last_ts}`);
    if (!this.last_ts) {
      return setTimeout(this.checkStatus, 5000);
    }
    if (moment(this.last_ts).isBefore(moment().subtract(1, "minutes"))) {
      debug("Check status: last chunk timestamp is older than 1 minute ago, reconnecting");
      return this.reconnect();
    }
    return setTimeout(this.checkStatus, 30000);
  }

  reconnect(ignoreConnectionStatus = false) {
    var msWaitToConnect, ref, ref1, ref2, ref3;
    boundMethodCheck(this, ProxySource);
    if (!this.connected && !ignoreConnectionStatus) {
      return;
    }
    msWaitToConnect = 5000;
    debug(`Reconnect to Icecast source from ${this.url} in ${msWaitToConnect}ms`);
    this.connected = false;
    // Clean proxy listeners
    this.chunksCount = 0;
    this.removeListener("_chunk", this.broadcastData);
    this.removeListener("_chunk", this.logChunk);
    // Clean icecast
    if ((ref = this.ireq) != null) {
      ref.end();
    }
    if ((ref1 = this.ireq) != null) {
      if ((ref2 = ref1.res) != null) {
        ref2.client.destroy();
      }
    }
    if ((ref3 = this.icecast) != null) {
      ref3.removeAllListeners();
    }
    this.icecast = null;
    this.ireq = null;
    this.parser = null;
    this.chunker = null;
    return setTimeout(this.connect, msWaitToConnect);
  }

};

//# sourceMappingURL=proxy.js.map
