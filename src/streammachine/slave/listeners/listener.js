const { EventEmitter } = require('events');

module.exports = class Listener extends EventEmitter {
  id = null;
  disconnected = false;

  constructor({ client, output, opts }) {
    super();

    this.connectedAt = Date.now();
    this.client = client;
    //this.rewinder = rewinder; // remove ref to output?
    this.output = output;
    this.opts = opts;

    this.hookEvents();
  }

  hookEvents() {
    this.output.once('disconnect', () => {
      this.disconnect();
    });

    /*
    if (!this._pumpOnly) {
      // for non-pump requests, we want to set a timer that will
      // log a segment every 30 seconds. This allows us to use the
      // same analytics pipeline as we do for HLS pumped data
      this._segTimer = setInterval(() => {
        var obj;
        obj = {
          //id: this.conn_id,
          bytes: this.bytesSent,
          seconds: this.secondsSent,
          contentTime: this.contentTime
        };
        this.emit("listen", obj);

        //this.rewind.recordListen(obj);

        // reset our stats
        this.bytesSent = 0;
        this.secondsSent = 0;
        return this.contentTime = null;
      }, opts.logInterval || 30 * 1000);
    }
     */
  }

  setId(id) {
    this.id = id;
  }

  getClient() {
    return this.client;
  }

  getQueuedBytes() {
    return this.output.getQueuedBytes();
  }

  disconnect() {

/*
    // Record either a) our full listening session (pump requests) or
    // b) the portion of the request that we haven't already recorded
    // (non-pump requests)
    obj = {
      //id: this.conn_id,
      bytes: this.bytesSent,
      seconds: this.secondsSent,
      offsetSeconds: this._offsetSeconds,
      contentTime: this.contentTime
    };
    this.emit("listen", obj);
*/



    if (this.disconnected) {
      return;
    }
    this.disconnected = true;

    this.output.disconnect();
    this.removeAllListeners();
    this.emit('disconnect');
  }
}
