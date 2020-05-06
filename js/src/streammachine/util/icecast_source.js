var FileSource, IcecastSource, debug, net;

FileSource = require("../sources/file_source");

net = require("net");

debug = require("debug")("sm:sources:icecast");

module.exports = IcecastSource = class IcecastSource extends require("events").EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this._connected = false;
    this.sock = null;
    // we'll use FileSource to read the file and chunk it for us
    this.fsource = new FileSource({
      format: this.opts.format,
      filePath: this.opts.filePath,
      chunkDuration: 0.2
    });
    this.fsource.on("data", (chunk) => {
      var ref;
      return (ref = this.sock) != null ? ref.write(chunk.data) : void 0;
    });
  }

  //----------
  start(cb) {
    var sFunc;
    sFunc = () => {
      this.fsource.start();
      return typeof cb === "function" ? cb(null) : void 0;
    };
    if (this.sock) {
      return sFunc();
    } else {
      return this._connect((err) => {
        if (err) {
          return cb(err);
        }
        this._connected = true;
        return sFunc();
      });
    }
  }

  //----------
  pause() {
    return this.fsource.stop();
  }

  //----------
  _connect(cb) {
    // -- Open our connection to the server -- #
    this.sock = net.connect(this.opts.port, this.opts.host, () => {
      var auth, authTimeout;
      debug("Connected!");
      authTimeout = null;
      // we really only care about the first thing we see
      this.sock.once("readable", () => {
        var err, resp;
        resp = this.sock.read();
        clearTimeout(authTimeout);
        if (resp && /^HTTP\/1\.0 200 OK/.test(resp.toString())) {
          debug("Got HTTP OK. Starting streaming.");
          return cb(null);
        } else {
          err = `Unknown response: ${resp.toString()}`;
          debug(err);
          cb(new Error(err));
          return this.disconnect();
        }
      });
      this.sock.write(`SOURCE /${this.opts.stream} HTTP/1.0\r\n`);
      //@sock.write "User-Agent: StreamMachine IcecastSource"
      if (this.opts.password) {
        // username doesn't matter.
        auth = Buffer.from(`source:${this.opts.password}`, 'ascii').toString("base64");
        this.sock.write(`Authorization: Basic ${auth}\r\n\r\n`);
        debug(`Writing auth with ${auth}.`);
      } else {
        this.sock.write("\r\n");
      }
      return authTimeout = setTimeout(() => {
        var err;
        err = "Timed out waiting for authentication.";
        debug(err);
        cb(new Error(err));
        return this.disconnect();
      }, 5000);
    });
    return this.sock.once("error", (err) => {
      debug(`Socket error: ${err}`);
      return this.disconnect();
    });
  }

  //----------
  disconnect() {
    var ref;
    this._connected = false;
    if ((ref = this.sock) != null) {
      ref.end();
    }
    this.sock = null;
    return this.emit("disconnect");
  }

};

//# sourceMappingURL=icecast_source.js.map
