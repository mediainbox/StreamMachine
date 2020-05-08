var IcecastSource;

module.exports = IcecastSource = (function() {
  class IcecastSource extends require("./base/base_source") {
    TYPE() {
      return `Icecast (${[this.opts.source_ip, this.opts.sock.remotePort].join(":")})`;
    }

    // opts should include:
    // format:   Format for Parser (aac or mp3)
    // sock:     Socket for incoming data
    // headers:  Headers from the source request
    // uuid:     Source UUID, if this is a handoff source (optional)
    // logger:   Logger (optional)
    constructor(opts) {
      var ref;
      super(opts, {
        useHeartbeat: true
      });
      this._shouldHandoff = true;
      // data is going to start streaming in as data on req. We need to pipe
      // it into a parser to turn it into frames, headers, etc
      if ((ref = this.log) != null) {
        ref.debug("New Icecast source.");
      }
      this._vtimeout = setTimeout(() => {
        var ref1;
        if ((ref1 = this.log) != null) {
          ref1.error("Failed to get source vitals before timeout. Forcing disconnect.");
        }
        return this.disconnect();
      }, 3000);
      this.once("vitals", () => {
        var ref1;
        if ((ref1 = this.log) != null) {
          ref1.debug("Vitals parsed for source.");
        }
        clearTimeout(this._vtimeout);
        return this._vtimeout = null;
      });
      this.createParser();
      // incoming -> Parser
      this.opts.sock.pipe(this.parser);
      this.last_ts = null;
      // outgoing -> Stream
      this.on("_chunk", function(chunk) {
        this.last_ts = chunk.ts;
        return this.emit("data", chunk);
      });
      this.opts.sock.on("close", () => {
        var ref1;
        if ((ref1 = this.log) != null) {
          ref1.debug("Icecast source got close event");
        }
        return this.disconnect();
      });
      this.opts.sock.on("end", () => {
        var ref1;
        if ((ref1 = this.log) != null) {
          ref1.debug("Icecast source got end event");
        }
        return this.disconnect();
      });
      // return with success
      this.connected = true;
    }

    //----------
    status() {
      var ref;
      return {
        source: (ref = typeof this.TYPE === "function" ? this.TYPE() : void 0) != null ? ref : this.TYPE,
        connected: this.connected,
        url: [this.opts.source_ip, this.opts.sock.remotePort].join(":"),
        streamKey: this.streamKey,
        uuid: this.uuid,
        last_ts: this.last_ts,
        connected_at: this.connectedAt
      };
    }

    //----------
    disconnect() {
      if (this.connected) {
        super.disconnect();
        if (this._vtimeout) {
          clearTimeout(this._vtimeout);
        }
        this.opts.sock.destroy();
        this.opts.sock.removeAllListeners();
        this.connected = false;
        this.emit("disconnect");
        return this.removeAllListeners();
      }
    }

  };

  IcecastSource.prototype.HANDOFF_TYPE = "icecast";

  return IcecastSource;

}).call(this);
