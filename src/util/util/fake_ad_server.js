var FakeAdServer, debug, express, fs;

express = require("express");

debug = require("debug")("sm:util:fake_ad_server");

fs = require("fs");

module.exports = FakeAdServer = class FakeAdServer extends require("events").EventEmitter {
  constructor(port, template, cb) {
    var s, xmldoc;
    super();
    this.port = port;
    this.template = template;
    // -- read our template -- #
    xmldoc = "";
    debug(`Template is ${this.template}`);
    s = fs.createReadStream(this.template);
    s.on("readable", () => {
      var r, results;
      results = [];
      while (r = s.read()) {
        results.push(xmldoc += r);
      }
      return results;
    });
    s.once("end", () => {
      debug("Template read complete");
      // -- prepare ad server -- #
      this.counter = 0;
      this.app = express();
      this.app.get("/impression", (req, res) => {
        var req_id;
        req_id = req.query["req_id"];
        this.emit("impression", req_id);
        return res.status(200).end("");
      });
      this.app.get("/ad", (req, res) => {
        var ad, req_id;
        req_id = this.counter;
        this.counter += 1;
        ad = xmldoc.replace("IMPRESSION", `http://127.0.0.1:${this.port}/impression?req_id=${req_id}`);
        this.emit("ad", req_id);
        return res.status(200).type("text/xml").end(ad);
      });
      s = this.app.listen(this.port);
      if (this.port === 0) {
        this.port = s.address().port;
      }
      debug("Setup complete");
      return typeof cb === "function" ? cb(null, this) : void 0;
    });
  }

};
