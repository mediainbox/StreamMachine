var BatchedQueue, debug;

debug = require("debug")("sm:util:batched_queue");

module.exports = BatchedQueue = class BatchedQueue extends require("stream").Transform {
  constructor(opts = {}) {
    super({
      objectMode: true
    });
    this.opts = opts;
    this._writableState.highWaterMark = this.opts.writable || 4096;
    this._readableState.highWaterMark = this.opts.readable || 1;
    this._size = this.opts.batch || 1000;
    this._latency = this.opts.latency || 200;
    debug(`Setting up BatchedQueue with size of ${this._size} and max latency of ${this._latency}ms`);
    this._queue = [];
    this._timer = null;
  }

  _transform(obj, encoding, cb) {
    this._queue.push(obj);
    if (this._queue.length >= this._size) {
      debug("Calling writeQueue for batch size");
      return this._writeQueue(cb);
    }
    if (!this._timer) {
      this._timer = setTimeout(() => {
        debug("Calling writeQueue after latency timeout");
        return this._writeQueue();
      }, this._latency);
    }
    return cb();
  }

  _flush(cb) {
    return this._writeQueue(cb);
  }

  _writeQueue(cb) {
    var batch;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    batch = this._queue.splice(0);
    debug(`Writing batch of ${batch.length} objects`);
    if (batch.length > 0) {
      this.push(batch);
    }
    return typeof cb === "function" ? cb() : void 0;
  }

};

//# sourceMappingURL=batched_queue.js.map
