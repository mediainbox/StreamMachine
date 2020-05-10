const { EventEmitter } = require('events');

// We disconnect clients that have fallen too far behind on their
// buffers. Buffer size can be configured via the "max_buffer" setting,
// which takes bits

module.exports = class Listener extends EventEmitter {
  id = null;

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
      this.emit('disconnect');
    });
  }

  setId(id) {
    this.id = id;
  }

  getQueuedBytes() {
    return this.output.getQueuedBytes();
  }

  disconnect() {
    this.output.disconnect(true);
  }
}
