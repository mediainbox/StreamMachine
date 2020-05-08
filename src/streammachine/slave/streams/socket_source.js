const http = require("http");
const {EventEmitter} = require("events");

/**
 * Emulate a source connection receiving data via sockets from master
 * Listens for the event "audio:STREAM_KEY" and emits "data"
 */
module.exports = class SocketSource extends EventEmitter {
  constructor(masterConnection, stream, ctx) {
    var getVitals;
    super();

    this.ctx = ctx;
    this.masterConnection = masterConnection;
    this.stream = stream;
    this.logger = ctx.logger.child({
      component: `stream[${stream.key}]:source`
    });


    this._streamKey = null;

    this.logger.debug(`create socket source`);

    this.ctx.events.on(`audio:${this.stream.key}`, (chunk) => {
      return this.emit("data", chunk);
    });

    getVitals = (retries = 0) => {
      return this.masterConnection.vitals(this.stream.key, (err, obj) => {
        if (err) {
          this.logger.error(`Failed to get vitals (${retries} retries remaining): ${err}`);
          if (retries > 0) {
            getVitals();
          }
          return;
        }
        this._streamKey = obj.streamKey;
        this._vitals = obj;
        return this.emit("vitals", obj);
      });
    };
    getVitals(2);
    this.stream.once("disconnect", () => {
      getVitals = function() {};
      return this.disconnect();
    });
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
  getStreamKey(cb) {
    if (this._streamKey) {
      return typeof cb === "function" ? cb(this._streamKey) : void 0;
    } else {
      return this.once("vitals", () => {
        return typeof cb === "function" ? cb(this._streamKey) : void 0;
      });
    }
  }

  //----------
  getRewind(cb) {
    var gRT, req;
    // connect to the master's StreamTransport and ask for any rewind
    // buffer that is available
    gRT = setTimeout(() => {
      this.logger.debug("Failed to get rewind buffer response.");
      return typeof cb === "function" ? cb("Failed to get a rewind buffer response.") : void 0;
    }, 15000);
    // connect to: @master.options.host:@master.options.port

    // GET request for rewind buffer
    this.logger.debug(`Making Rewind Buffer request for ${this.stream.key}`, {
      sock_id: this.masterConnection.id
    });
    req = http.request({
      hostname: this.masterConnection.io.io.opts.host,
      port: this.masterConnection.io.io.opts.port,
      path: `/s/${this.stream.key}/rewind`,
      headers: {
        'stream-slave-id': this.masterConnection.id
      }
    }, (res) => {
      clearTimeout(gRT);
      this.logger.debug(`Got Rewind response with status code of ${res.statusCode}`);
      if (res.statusCode === 200) {
        return typeof cb === "function" ? cb(null, res) : void 0;
      } else {
        return typeof cb === "function" ? cb("Rewind request got a non-500 response.") : void 0;
      }
    });
    req.on("error", (err) => {
      clearTimeout(gRT);
      this.logger.debug(`Rewind request got error: ${err}`, {
        error: err
      });
      return typeof cb === "function" ? cb(err) : void 0;
    });
    return req.end();
  }

  //----------
  disconnect() {
    this.logger.debug(`SocketSource disconnecting for ${this.stream.key}`);
    return this.stream = null;
  }

};