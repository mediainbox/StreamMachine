var LoopingSource, Throttle, file, filepath, fs, lsource, net, path, ref, sock, throttle;

fs = require("fs");

path = require("path");

net = require("net");

Throttle = require("throttle");

this.args = require("optimist").usage("Usage: $0 --host localhost --port 8001 --stream foo --password abc123 [file]").describe({
  host: "Server",
  port: "Server source port",
  stream: "Stream key",
  password: "Stream password",
  rate: "Throttle rate for streaming"
}).default({
  rate: 32000
}).demand("host", "port", "stream").argv;

// -- Looping Source -- #
LoopingSource = class LoopingSource extends require('stream').Duplex {
  constructor(opts) {
    super(opts);
    this._reading = false;
    this._data = Buffer.alloc(0);
    this._readPos = 0;
  }

  //----------
  _write(chunk, encoding, cb) {
    var buf;
    buf = Buffer.concat([this._data, chunk]);
    this._data = buf;
    console.log("_data length is now ", this._data.length);
    if (!this.reading) {
      this.emit("readable");
    }
    return cb();
  }

  //----------
  _read(size) {
    var rFunc;
    if (this._reading) {
      console.log("_read while reading");
      return true;
    }
    if (this._data.length === 0) {
      this.push('');
      return true;
    }
    this._reading = true;
    rFunc = () => {
      var buf, remaining;
      remaining = Math.min(this._data.length - this._readPos, size);
      console.log(`reading from ${this._readPos} with ${remaining}`);
      buf = Buffer.from(remaining);
      this._data.copy(buf, 0, this._readPos, this._readPos.remaining);
      this._readPos = this._readPos + remaining;
      if (this._readPos >= this._data.length) {
        this._readPos = 0;
      }
      console.log(`pushing buffer of ${buf.length}`);
      if (this.push(buf, 'binary')) {
        return rFunc();
      } else {
        return this._reading = false;
      }
    };
    return rFunc();
  }

};

// -- Make sure they gave us a file -- #
filepath = (ref = this.args._) != null ? ref[0] : void 0;

if (!filepath) {
  console.error("A file path is required.");
  process.exit(1);
}

filepath = path.resolve(filepath);

if (!fs.existsSync(filepath)) {
  console.error("File not found.");
  process.exit(1);
}

console.log("file is ", filepath);

// -- Read the file -- #
lsource = new LoopingSource();

throttle = new Throttle(this.args.rate);

file = fs.createReadStream(filepath);

file.pipe(lsource);

lsource.pipe(throttle);

// -- Open our connection to the server -- #
sock = net.connect(this.args.port, this.args.host, () => {
  var auth, authTimeout;
  console.log("Connected!");
  authTimeout = null;
  // we really only care about the first thing we see
  sock.once("readable", () => {
    var resp;
    resp = sock.read();
    if (/^HTTP\/1\.0 200 OK/.test(resp.toString())) {
      console.log("Got HTTP OK. Starting streaming.");
      clearTimeout(authTimeout);
      return throttle.pipe(sock);
    } else {
      console.error(`Unknown response: ${resp.toString()}`);
      return process.exit(1);
    }
  });
  sock.write(`SOURCE /${this.args.stream} ICE/1.0\r\n`);
  if (this.args.password) {
    // username doesn't matter.
    auth = Buffer.from(`source:${this.args.password}`, 'ascii').toString("base64");
    sock.write(`Authorization: basic ${auth}\r\n\r\n`);
    console.log(`Writing auth with ${auth}.`);
  }
  return authTimeout = setTimeout(() => {
    console.error("Timed out waiting for authentication.");
    return process.exit(1);
  }, 5000);
});

sock.on("error", (err) => {
  console.error(`Socket error: ${err}`);
  return process.exit(1);
});

//# sourceMappingURL=icecast_source.js.map
