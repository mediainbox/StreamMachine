const _ = require("lodash");
const BaseOutput = require('./base_output');

module.exports = class BaseHttpOutput extends BaseOutput {
  format = null;
  disconnected = true;

  constructor({ stream, req, res, ctx }) {
    super({ stream, ctx });

    this.req = res;
    this.res = res;
    this.format = stream.config.format;
    this.socket = req.connection;

    this.hookEvents();
    this.configure({
      "Content-Type": this.getContentType(),
      "Accept-Ranges": "none",
    });
  }

  getContentType() {
    return this.format === "mp3" ? "audio/mpeg" : (this.format === "aac" ? "audio/aacp" : "unknown");
  }

  configure() {
    throw new Error('Must implement!');
  }

  hookEvents() {
    this.socket.on("end", () => {
      this.disconnect();
    });

    this.socket.on("close", () => {
      this.disconnect();
    });

    this.socket.on("error", (err) => {
      if (err.code !== 'ECONNRESET') {
        this.logger.debug(`got client socket error: ${err}`);
      }

      this.disconnect();
    });
  }

  disconnect(internal = true) {
    if (this.disconnected) {
      return;
    }
    this.disconnected = true;

    if (!this.socket.destroyed) {
      this.socket.end();
    }

    if (this.source) { // source = Rewinder
      this.source.disconnect();
    }

    if (internal) {
      this.emit("disconnect");
    }

    this.logger.debug('output disconnected');
    this.removeAllListeners();
  }
};
