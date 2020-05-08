var FakeTranscoder, debug, express, fs;

express = require("express");

debug = require("debug")("sm:util:fake_transcoder");

fs = require("fs");

module.exports = FakeTranscoder = class FakeTranscoder extends require("events").EventEmitter {
  constructor(port, files_dir) {
    var s;
    super();
    this.port = port;
    this.files_dir = files_dir;
    this.app = express();
    this.app.get("/encoding", (req, res) => {
      var e, f, key, s, uri;
      key = req.query["key"];
      uri = req.query["uri"];
      if (!key || !uri) {
        return res.status(400).end("Key and URI are required.");
      }
      debug(`Fake Transcoder request for ${key}: ${uri}`);
      this.emit("request", {
        key: key,
        uri: uri
      });
      try {
        // FIXME: recognize extension to support aac
        f = `${this.files_dir}/${key}.mp3`;
        debug(`Attempting to send ${f}`);
        s = fs.createReadStream(f);
        s.pipe(res.status(200).type('audio/mpeg'));
        return s.once("end", () => {
          return debug("Transcoder response sent");
        });
      } catch (error) {
        e = error;
        return res.status(500).end(`Failed to open static file: ${e}`);
      }
    });
    s = this.app.listen(this.port);
    if (this.port === 0) {
      this.port = s.address().port;
    }
  }

};
