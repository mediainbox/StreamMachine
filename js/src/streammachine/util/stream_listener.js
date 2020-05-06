var Icy, StreamListener, _, debug, http;

Icy = require("icy");

http = require("http");

debug = require("debug")("sm:util:stream_listener");

_ = require("underscore");

module.exports = StreamListener = class StreamListener extends require("events").EventEmitter {
  constructor(host, port, stream, shoutcast = false) {
    super();
    this.host = host;
    this.port = port;
    this.stream = stream;
    this.shoutcast = shoutcast;
    this.bytesReceived = 0;
    this.url = `http://${this.host}:${this.port}/${this.stream}`;
    this.req = null;
    this.res = null;
    debug(`Created new Stream Listener for ${this.url}`);
    this.disconnected = false;
  }

  //----------
  connect(timeout, cb) {
    var _connected, abortT, aborted, cLoop, connect_func;
    if (_.isFunction(timeout)) {
      cb = timeout;
      timeout = null;
    }
    aborted = false;
    if (timeout) {
      abortT = setTimeout(() => {
        aborted = true;
        return cb(new Error("Reached timeout without successful connection."));
      }, timeout);
    }
    _connected = (res) => {
      if (abortT) {
        clearTimeout(abortT);
      }
      this.res = res;
      debug(`Connected. Response code is ${res.statusCode}.`);
      if (res.statusCode !== 200) {
        cb(new Error(`Non-200 Status code: ${res.statusCode}`));
        return false;
      }
      if (typeof cb === "function") {
        cb();
      }
      this.emit("connected");
      // -- listen for data -- #
      this.res.on("metadata", (meta) => {
        return this.emit("metadata", Icy.parse(meta));
      });
      this.res.on("readable", () => {
        var data, results;
        results = [];
        while (data = this.res.read()) {
          this.bytesReceived += data.length;
          results.push(this.emit("bytes"));
        }
        return results;
      });
      // -- listen for an early exit -- #
      this.res.once("error", (err) => {
        debug(`Listener connection error: ${err}`);
        if (!this.disconnected) {
          return this.emit("error");
        }
      });
      return this.res.once("close", () => {
        debug("Listener connection closed.");
        if (!this.disconnected) {
          return this.emit("close");
        }
      });
    };
    connect_func = this.shoutcast ? Icy.get : http.get;
    cLoop = () => {
      debug(`Attempting connect to ${this.url}`);
      this.req = connect_func(this.url, _connected);
      this.req.once("socket", (sock) => {
        return this.emit("socket", sock);
      });
      return this.req.once("error", (err) => {
        if (err.code === "ECONNREFUSED") {
          if (!aborted) {
            return setTimeout(cLoop, 50);
          }
        } else {
          return cb(err);
        }
      });
    };
    return cLoop();
  }

  //----------
  disconnect(cb) {
    this.disconnected = true;
    this.res.socket.destroy();
    return typeof cb === "function" ? cb() : void 0;
  }

};

//# sourceMappingURL=stream_listener.js.map
