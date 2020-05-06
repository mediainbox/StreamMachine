var BaseOutput, RawAudio, debug;

BaseOutput = require("./base");

debug = require("debug")("sm:outputs:raw_audio");

module.exports = RawAudio = class RawAudio extends BaseOutput {
  constructor(stream, opts) {
    var headers;
    super("raw", stream, opts);
    this.disconnected = false;
    debug("Incoming request.");
    this.pump = true;
    if (this.opts.req && this.opts.res) {
      this.client.offsetSecs = this.opts.req.query.offset || -1;
      this.opts.res.chunkedEncoding = false;
      this.opts.res.useChunkedEncodingByDefault = false;
      headers = {
        "Content-Type": this.stream.opts.format === "mp3" ? "audio/mpeg" : this.stream.opts.format === "aac" ? "audio/aacp" : "unknown",
        "Accept-Ranges": "none"
      };
      // write out our headers
      this.opts.res.writeHead(200, headers);
      this.opts.res._send('');
      process.nextTick(() => {
        return this.stream.startSession(this.client, (err, session_id) => {
          this.client.session_id = session_id;
          // -- send a preroll if we have one -- #
          if (this.stream.preroll && !this.opts.req.query.preskip) {
            debug(`making preroll request on stream ${this.stream.key}`);
            return this.stream.preroll.pump(this, this.socket, (err) => {
              return this.connectToStream();
            });
          } else {
            return this.connectToStream();
          }
        });
      });
    } else if (this.opts.socket) {
      // -- just the data -- #
      this.pump = false;
      process.nextTick(() => {
        return this.connectToStream();
      });
    } else {
      // fail
      this.stream.log.error("Listener passed without connection handles or socket.");
    }
    // register our various means of disconnection
    this.socket.on("end", () => {
      return this.disconnect();
    });
    this.socket.on("close", () => {
      return this.disconnect();
    });
    this.socket.on("error", (err) => {
      this.stream.log.debug(`Got client socket error: ${err}`);
      return this.disconnect();
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

  //----------
  prepForHandoff(cb) {
    // remove the initial client.offsetSecs if it exists
    delete this.client.offsetSecs;
    return typeof cb === "function" ? cb() : void 0;
  }

  //----------
  connectToStream() {
    if (!this.disconnected) {
      debug(`Connecting to stream ${this.stream.key}`);
      return this.stream.listen(this, {
        offsetSecs: this.client.offsetSecs,
        offset: this.client.offset,
        pump: this.pump,
        startTime: this.opts.startTime
      }, (err, source) => {
        var ref;
        this.source = source;
        if (err) {
          if (this.opts.res != null) {
            this.opts.res.status(500).end(err);
          } else {
            if ((ref = this.socket) != null) {
              ref.end();
            }
          }
          return false;
        }
        // update our offset now that it's been checked for availability
        this.client.offset = this.source.offset();
        return this.source.pipe(this.socket);
      });
    }
  }

};

//# sourceMappingURL=raw_audio.js.map
