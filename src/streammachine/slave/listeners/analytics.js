

recordListen(opts) {
  var lmeta, nothing;
  if (opts.bytes) {
    // temporary conversion support...
    opts.kbytes = Math.floor(opts.bytes / 1024);
  }
  if (_.isNumber(opts.kbytes)) {
    this.stats.kbytesSent += opts.kbytes;
  }

  const listener = this.listeners.get(opts.id);
  if (listener) {
    this.ctx.events.emit(Events.Listener.LISTEN, {
      stream: this.key,
      type: "listen",
      client: listener.obj.client,
      time: new Date(),
      kbytes: opts.kbytes,
      duration: opts.seconds,
      offsetSeconds: opts.offsetSeconds,
      contentTime: opts.contentTime
    });
  }
}



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
