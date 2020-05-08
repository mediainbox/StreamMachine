var ChunkGenerator, _, debug;

_ = require("underscore");

debug = require("debug")("sm:util:chunk_generator");

// Generate fake audio chunks for testing
module.exports = ChunkGenerator = class ChunkGenerator extends require("stream").Readable {
  constructor(start_ts, chunk_duration) {
    super({
      objectMode: true
    });
    this.start_ts = start_ts;
    this.chunk_duration = chunk_duration;
    this._count_f = 0;
    this._count_b = 1;
  }

  skip_forward(count, cb) {
    this._count_f += count;
    return typeof cb === "function" ? cb() : void 0;
  }

  skip_backward(count, cb) {
    this._count_b += count;
    return typeof cb === "function" ? cb() : void 0;
  }

  ts() {
    return {
      forward: new Date(Number(this.start_ts) + this._count_f * this.chunk_duration),
      backward: new Date(Number(this.start_ts) + this._count_b * this.chunk_duration)
    };
  }

  forward(count, cb) {
    var af;
    af = _.after(count, () => {
      this._count_f += count;
      this.emit("readable");
      debug(`Forward emit ${count} chunks. Finished at ${new Date(Number(this.start_ts) + this._count_f * this.chunk_duration)}`);
      return typeof cb === "function" ? cb() : void 0;
    });
    return _(count).times((c) => {
      var chunk;
      chunk = {
        ts: new Date(Number(this.start_ts) + (this._count_f + c) * this.chunk_duration),
        duration: this.chunk_duration,
        data: Buffer.alloc(0)
      };
      this.push(chunk);
      return af();
    });
  }

  backward(count, cb) {
    var af;
    af = _.after(count, () => {
      this._count_b += count;
      this.emit("readable");
      debug(`Backward emit ${count} chunks. Finished at ${new Date(Number(this.start_ts) + this._count_b * this.chunk_duration)}`);
      return typeof cb === "function" ? cb() : void 0;
    });
    return _(count).times((c) => {
      var chunk;
      chunk = {
        ts: new Date(Number(this.start_ts) - (this._count_b + c) * this.chunk_duration),
        duration: this.chunk_duration,
        data: Buffer.alloc(0)
      };
      this.push(chunk);
      return af();
    });
  }

  end() {
    return this.push(null);
  }

  _read(size) {}

};

// do nothing?
