const { EventEmitter } = require('events');

module.exports = class Listener extends EventEmitter {
  id = null;
  disconnected = false;

  constructor({ client, output, opts }) {
    super();

    this.connectedAt = Date.now();
    this.client = client;
    this.output = output;
    this.opts = opts;

    this.hookEvents();
  }

  hookEvents() {
    this.output.once('disconnect', () => {
      this.disconnect();
    });
  }

  setId(id) {
    this.id = id;
  }

  getQueuedBytes() {
    return this.output.getQueuedBytes();
  }

  disconnect() {
    if (this.disconnected) {
      return;
    }
    this.disconnected = true;

    this.output.disconnect();
    this.removeAllListeners();
    this.emit('disconnect');
  }
}
