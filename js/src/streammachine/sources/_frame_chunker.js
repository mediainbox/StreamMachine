var FrameChunker, Transform,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

Transform = require("stream").Transform;

module.exports = FrameChunker = (function(_super) {
  __extends(FrameChunker, _super);

  function FrameChunker(duration, initialTime) {
    this.duration = duration;
    this.initialTime = initialTime != null ? initialTime : new Date();
    this._chunk_queue = [];
    this._queue_duration = 0;
    this._remainders = 0;
    this._target = this.duration;
    this._last_ts = null;
    FrameChunker.__super__.constructor.call(this, {
      objectMode: true
    });
  }

  FrameChunker.prototype.resetTime = function(ts) {
    this._last_ts = null;
    this._remainders = 0;
    return this.initialTime = ts;
  };

  FrameChunker.prototype._transform = function(obj, encoding, cb) {
    var buf, duration, frames, len, o, simple_dur, simple_rem, ts, _i, _len, _ref;
    this._chunk_queue.push(obj);
    this._queue_duration += obj.header.duration;
    if (this._queue_duration > this._target) {
      this._target = this._target + (this.duration - this._queue_duration);
      len = 0;
      _ref = this._chunk_queue;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        o = _ref[_i];
        len += o.frame.length;
      }
      frames = this._chunk_queue.length;
      buf = Buffer.concat((function() {
        var _j, _len1, _ref1, _results;
        _ref1 = this._chunk_queue;
        _results = [];
        for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
          o = _ref1[_j];
          _results.push(o.frame);
        }
        return _results;
      }).call(this));
      duration = this._queue_duration;
      this._chunk_queue.length = 0;
      this._queue_duration = 0;
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
  };

  return FrameChunker;

})(Transform);

//# sourceMappingURL=_frame_chunker.js.map
