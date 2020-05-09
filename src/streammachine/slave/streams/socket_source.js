const http = require("http");
const {EventEmitter} = require("events");
const {Events} = require('../../events');

/**
 * Emulate a source connection receiving data via sockets from master
 * Listens for the event "audio:STREAM_KEY" and emits "data"
 */
module.exports = class SocketSource extends EventEmitter {
  constructor({ key, connection, ctx }) {
    super();

    this.key = key;
    this.ctx = ctx;
    this.connection = connection;
    this.logger = ctx.logger.child({
      component: `stream[${key}]:source`
    });

    this.logger.debug(`create socket source`);

    this.hookEvents();
  }

  hookEvents() {
    // listen to audio event (now emitted by master connection)
    this.ctx.events.on(`audio:${this.key}`, (chunk) => {
      return this.emit("data", chunk);
    });
  }

  //----------
  disconnect() {
    this.logger.debug(`SocketSource disconnecting for ${this.key}`);
  }
};
