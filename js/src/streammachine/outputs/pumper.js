var BaseOutput, Pumper, debug;

BaseOutput = require("./base");

debug = require("debug")("sm:outputs:pumper");

module.exports = Pumper = class Pumper extends BaseOutput {
  constructor(stream, opts) {
    super("pumper");
    this.stream = stream;
    this.opts = opts;
    // figure out what we're pulling
    this.stream.listen(this, {
      offsetSecs: this.opts.req.query.from || this.opts.req.query.pump,
      pump: this.opts.req.query.pump,
      pumpOnly: true
    }, (err, source, info) => {
      var headers;
      this.source = source;
      if (err) {
        this.opts.res.status(500).end(err);
        return false;
      }
      headers = {
        "Content-Type": this.stream.opts.format === "mp3" ? "audio/mpeg" : this.stream.opts.format === "aac" ? "audio/aacp" : "unknown",
        "Connection": "close",
        "Content-Length": info.length
      };
      // write out our headers
      this.opts.res.writeHead(200, headers);
      // send our pump buffer to the client
      this.source.pipe(this.opts.res);
      // register our various means of disconnection
      this.socket.on("end", () => {
        return this.disconnect();
      });
      this.socket.on("close", () => {
        return this.disconnect();
      });
      return this.socket.on("error", (err) => {
        this.stream.log.debug(`Got client socket error: ${err}`);
        return this.disconnect();
      });
    });
  }

  //----------
  disconnect() {
    return super.disconnect(() => {
      var ref, ref1;
      if ((ref = this.source) != null) {
        ref.disconnect();
      }
      if (!this.socket.destroyed) {
        return (ref1 = this.socket) != null ? ref1.end() : void 0;
      }
    });
  }

};

//# sourceMappingURL=pumper.js.map
