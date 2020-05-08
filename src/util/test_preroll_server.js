var $file, PrerollServer, express, fs, path, pre;

express = require("express");

fs = require("fs");

path = require("path");

$file = function(file) {
  return path.resolve(__dirname, "..", file);
};

PrerollServer = class PrerollServer {
  constructor(files, _on = true) {
    this.files = files;
    this._on = _on;
    this.app = express();
    this.app.get("/:key/:streamkey", (req, res, next) => {
      var f, ref, stream;
      console.log(`Preroll request for ${req.path}`);
      if (f = (ref = this.files[req.param("key")]) != null ? ref[req.param("streamkey")] : void 0) {
        if (this._on) {
          res.header("Content-Type", "audio/mpeg");
          res.status(200);
          stream = fs.createReadStream(f);
          return stream.pipe(res);
        } else {
          // what should we do to test a bad server?
          return setTimeout(() => {
            // end unexpectedly
            return res.end();
          }, 3000);
        }
      } else {
        return next();
      }
    });
    this.app.get("*", (req, res, next) => {
      console.log(`Invalid request to ${req.path}`);
      return next();
    });
    this.app.listen(process.argv[2]);
  }

  toggle() {
    this._on = !this._on;
    return console.log(`Responses are ${this._on ? "on" : "off"}`);
  }

};

pre = new PrerollServer({
  test: {
    "mp3-44100-128-m": $file("test/files/mp3/tone250Hz-44100-128-m.mp3")
  }
});

process.on("SIGUSR2", function() {
  return pre.toggle();
});

console.log(`PID is ${process.pid}`);
