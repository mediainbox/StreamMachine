var FrameChunker, Transform;

Transform = require("stream").Transform;

module.exports = FrameChunker = class FrameChunker extends Transform {
  constructor(duration1, initialTime = new Date()) {
    super({
      objectMode: true
    });
    this.duration = duration1;
    this.initialTime = initialTime;
    this._chunk_queue = [];
    this._queue_duration = 0;
    this._remainders = 0;
    this._target = this.duration;
    this._last_ts = null;
  }

  //----------
  resetTime(ts) {
    this._last_ts = null;
    this._remainders = 0;
    return this.initialTime = ts;
  }

  //----------
  _transform(obj, encoding, cb) {
    var buf, duration, frames, i, len, len1, o, ref, simple_dur, simple_rem, ts;
    this._chunk_queue.push(obj);
    this._queue_duration += obj.header.duration;
    if (this._queue_duration > this._target) {
      // reset our target for the next chunk
      this._target = this._target + (this.duration - this._queue_duration);
      // what's the total data length?
      len = 0;
      ref = this._chunk_queue;
      for (i = 0, len1 = ref.length; i < len1; i++) {
        o = ref[i];
        len += o.frame.length;
      }
      // how many frames?
      frames = this._chunk_queue.length;
      // make one buffer
      buf = Buffer.concat((function() {
        var j, len2, ref1, results;
        ref1 = this._chunk_queue;
        results = [];
        for (j = 0, len2 = ref1.length; j < len2; j++) {
          o = ref1[j];
          results.push(o.frame);
        }
        return results;
      }).call(this));
      duration = this._queue_duration;
      // reset queue
      this._chunk_queue.length = 0;
      this._queue_duration = 0;
      // what's the timestamp for this chunk? If it seems reasonable
      // to attach it to the last chunk, let's do so.
      simple_dur = Math.floor(duration);
      this._remainders += duration - simple_dur;
      if (this._remainders > 1) {
        simple_rem = Math.floor(this._remainders);
        this._remainders = this._remainders - simple_rem;
        simple_dur += simple_rem;
      }
      ts = this._last_ts ? new Date(Number(this._last_ts) + simple_dur) : this.initialTime;
      this._last_ts = ts;
      this.push({
        data: buf,
        ts: ts,
        duration: duration,
        frames: frames,
        streamKey: obj.header.stream_key
      });
    }
    return cb();
  }

};

//# sourceMappingURL=_frame_chunker.js.map
