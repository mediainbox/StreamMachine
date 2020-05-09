const _ = require("lodash");
const uuid = require("uuid");
const EventEmitter = require("events").EventEmitter;
const BaseOutput = require('./base_output');

module.exports = class BaseHttpOutput extends BaseOutput {
  initialized = false;
  disconnected = true;
  socket = null;

  constructor({ stream, ctx, req, res }) {
    super({ stream, ctx});

    this.req = req;
    this.res = res;
    this.socket = req.connection;
    this.format = stream.config.format;

    // TODO: move to class
    // this is the listening client
    this.client = {
      output: this.type,
      ip: req.ip,
      path: req.url,
      ua: this.getUserAgent(),
      user_id: req.tracking.unique_listener_id,
      session_id: req.tracking.session_id,
    };

    this.baseHeaders = {
      "Content-Type": this.getContentType(),
      "Accept-Ranges": "none",
    };
  }

  init() {
    this.hookEvents();
    this.configureResponse(this.baseHeaders);
    this.initialized = true;
    this.disconnected = false;
  }

  configureResponse() {
    throw new Error('Must implement!');
  }

  getUserAgent() {
    return this.req.query.ua || this.req.get('user-agent');
  }

  getContentType() {
    return this.format === "mp3" ? "audio/mpeg" : (this.format === "aac" ? "audio/aacp" : "unknown");
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

  disconnect() {
    if (this.disconnected) {
      return;
    }

    //this.source.disconnect();

    if (!this.socket.destroyed) {
      this.socket.end();
    }

    this.disconnected = true;
    this.emit("disconnect");
  }
};
