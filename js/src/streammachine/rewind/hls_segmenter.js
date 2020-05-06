var Debounce, HLSSegmenter, MAX_PTS, _, tz;

_ = require("underscore");

tz = require('timezone');

Debounce = require("../util/debounce");

// -- HTTP Live Streaming Segmenter -- #

// each segment would include:
// id:       timestamp
// duration: cumulative timestamp
// buffers:  array of buffer refs
// header:   computed ID3 header
MAX_PTS = Math.pow(2, 33) - 1;

module.exports = HLSSegmenter = (function() {
  class HLSSegmenter extends require("events").EventEmitter {
    constructor(rewind, segment_length, log) {
      super();
      this.rewind = rewind;
      this.segment_length = segment_length;
      this.log = log;
      this.segments = [];
      this._rewindLoading = false;
      // Injector creates segment objects out of audio chunks. It doesn't
      // do segment IDs, ordering or discontinuities
      this.injector = new HLSSegmenter.Injector(this.segment_length * 1000, this.log);
      // Finalizer takes the half-baked segments, gives them IDs and puts them
      // in the correct order. We defer loading the finalizer object until
      // either a) data starts coming into the injector or b) we get a map
      // loaded
      this._snapDebounce = new Debounce(1000, () => {
        return this.finalizer.snapshot((err, snap) => {
          return this.emit("snapshot", {
            segment_duration: this.segment_length,
            segments: snap
          });
        });
      });
      this.finalizer = null;
      this._createFinalizer = _.once((map) => {
        this.finalizer = new HLSSegmenter.Finalizer(this.log, this.segment_length * 1000, map);
        this.injector.pipe(this.finalizer);
        this.segments = this.finalizer.segments;
        this.finalizer.on("add", () => {
          return this._snapDebounce.ping();
        });
        this.finalizer.on("remove", () => {
          var ref;
          this._snapDebounce.ping();
          if (!this._rewindLoading && this.segments[0]) {
            return (ref = this.group) != null ? ref.hlsUpdateMinSegment(Number(this.segments[0].ts)) : void 0;
          }
        });
        return this.emit("_finalizer");
      });
      this.injector.once("readable", () => {
        // we'll give one more second for a map to come in. Data will just
        // queue up in the injector
        return setTimeout(() => {
          return this._createFinalizer();
        }, 1000);
      });
      // The RewindBuffer can get data simultaneously inserted from two
      // directions.  New live data will be emitted as an rpush and will
      // go forward in timestamp.  Loading buffer data will be emitted
      // as an runshift and will go backward in time. We need to listen
      // and construct segments for each.
      this.rewind.on("rpush", (c) => {
        return this.injector.write(c);
      });
      this.rewind.on("runshift", (c) => {
        return this.injector.write(c);
      });
      this.rewind.on("rshift", (chunk) => {
        var ref;
        // Data is being removed from the rewind buffer.  we should
        // clean up our segments as needed
        return (ref = this.finalizer) != null ? ref.expire(chunk.ts, (err, seg_id) => {
          if (err) {
            this.log.error(`Error expiring audio chunk: ${err}`);
            return false;
          }
        }) : void 0;
      });
      // This event is triggered when RewindBuffer gets a call to loadBuffer.
      // We use it to make sure we don't emit an UpdateMinSegment call while
      // we're still loading backwards
      this.rewind.once("rewind_loading", () => {
        return this._rewindLoading = true;
      });
      // This event is triggered when RewindBuffer's loadBuffer is completed.
      // Once we're done processing the data it received, we should update our
      // group with our first segment ID.
      this.rewind.once("rewind_loaded", () => {
        // ask the injector to push any initial segment that it is holding
        return this.injector._flush(() => {
          this.log.debug("HLS Injector flushed");
          return this.once("snapshot", () => {
            var ref;
            this.log.debug(`HLS rewind loaded and settled. Length: ${this.segments.length}`);
            this._rewindLoading = false;
            if (this.segments[0]) {
              return (ref = this.group) != null ? ref.hlsUpdateMinSegment(Number(this.segments[0].ts)) : void 0;
            }
          });
        });
      });
      this._gSyncFunc = (ts) => {
        var ref;
        return (ref = this.finalizer) != null ? ref.setMinTS(ts, (err, seg_id) => {
          return this.log.debug(`Synced min segment TS to ${ts}. Got ${seg_id}.`);
        }) : void 0;
      };
    }

    //----------
    syncToGroup(g = null) {
      if (this.group) {
        this.group.removeListener("hls_update_min_segment", this._gSyncFunc);
        this.group = null;
      }
      if (g) {
        this.group = g;
        this.group.addListener("hls_update_min_segment", this._gSyncFunc);
      }
      return true;
    }

    //----------
    _dumpMap(cb) {
      // dump our sequence information and a segment map from the finalizer
      if (this.finalizer) {
        return this.finalizer.dumpMap(cb);
      } else {
        return cb(null, null);
      }
    }

    _loadMap(map) {
      return this._createFinalizer(map);
    }

    //----------
    status() {
      var ref, ref1, ref2, ref3, status;
      return status = {
        hls_segments: this.segments.length,
        hls_first_seg_id: (ref = this.segments[0]) != null ? ref.id : void 0,
        hls_first_seg_ts: (ref1 = this.segments[0]) != null ? ref1.ts : void 0,
        hls_last_seg_id: (ref2 = this.segments[this.segments.length - 1]) != null ? ref2.id : void 0,
        hls_last_seg_ts: (ref3 = this.segments[this.segments.length - 1]) != null ? ref3.ts : void 0
      };
    }

    //----------
    snapshot(cb) {
      if (this.finalizer) {
        return this.finalizer.snapshot((err, segments) => {
          return cb(null, {
            segments: segments,
            segment_duration: this.segment_length
          });
        });
      } else {
        return cb(null, null);
      }
    }

    //----------
    pumpSegment(id, cb) {
      var seg;
      if (seg = this.segment_idx[id]) {
        return cb(null, seg);
      } else {
        return cb(new Error("HTTP Live Streaming segment not found."));
      }
    }

  };

  //----------
  HLSSegmenter.Injector = class Injector extends require("stream").Transform {
    constructor(segment_length, log) {
      super({
        objectMode: true
      });
      this.segment_length = segment_length;
      this.log = log;
      this.first_seg = null;
      this.last_seg = null;
    }

    //----------
    _transform(chunk, encoding, cb) {
      var ref, ref1, seg;
      if (this.last_seg && ((this.last_seg.ts <= (ref = chunk.ts) && ref < this.last_seg.end_ts))) {
        // in our chunk going forward
        this.last_seg.buffers.push(chunk);
        return cb();
      } else if (this.first_seg && ((this.first_seg.ts <= (ref1 = chunk.ts) && ref1 < this.first_seg.end_ts))) {
        // in our chunk going backward
        this.first_seg.buffers.unshift(chunk);
        return cb();
      } else if (!this.last_seg || (chunk.ts >= this.last_seg.end_ts)) {
        // create a new segment for it
        seg = this._createSegment(chunk.ts);
        if (!seg) {
          return cb();
        }
        seg.buffers.push(chunk);
        if (!this.first_seg) {
          this.first_seg = this.last_seg;
        } else {
          // send our previous segment off to be finalized
          if (this.last_seg) {
            this.emit("push", this.last_seg);
            this.push(this.last_seg);
          }
        }
        // stash our new last segment
        this.last_seg = seg;
        return cb();
      } else if (!this.first_seg || (chunk.ts < this.first_seg.ts)) {
        // create a new segment for it
        seg = this._createSegment(chunk.ts);
        if (!seg) {
          return cb();
        }
        seg.buffers.push(chunk);
        // send our previous first segment off to be finalized
        if (this.first_seg) {
          this.emit("push", this.first_seg);
          this.push(this.first_seg);
        }
        // stash our new first segment
        this.first_seg = seg;
        return cb();
      } else {
        this.log.error("Not sure where to place segment!!! ", {
          chunk_ts: chunk.ts
        });
        return cb();
      }
    }

    //----------
    _flush(cb) {
      var b, duration, i, j, len, len1, ref, ref1, seg;
      ref = [this.first_seg, this.last_seg];
      // if either our first or last segments are "complete", go ahead and
      // emit them
      for (i = 0, len = ref.length; i < len; i++) {
        seg = ref[i];
        if (seg) {
          duration = 0;
          ref1 = seg.buffers;
          for (j = 0, len1 = ref1.length; j < len1; j++) {
            b = ref1[j];
            duration += b.duration;
          }
          this.log.debug(`HLS Injector flush checking segment: ${seg.ts}, ${duration}`);
          if (duration >= this.segment_length) {
            this.emit("push", seg);
            this.push(seg);
          }
        }
      }
      return cb();
    }

    //----------
    _createSegment(ts) {
      var seg_start;
      // There are two scenarios when we're creating a segment:
      // 1) We have a segment map in memory, and we will return IDs from that
      //    map for segments that already have them assigned. This is the case
      //    if we're loading data back into memory.
      // 2) We're creating new segments, and should be incrementing the
      //    @_segmentSeq as we go.
      seg_start = Math.floor(Number(ts) / this.segment_length) * this.segment_length;
      return {
        // id will be filled in when we go to finalize
        id: null,
        ts: new Date(seg_start),
        end_ts: new Date(seg_start + this.segment_length),
        buffers: []
      };
    }

  };

  //----------
  HLSSegmenter.Finalizer = class Finalizer extends require("stream").Writable {
    constructor(log, segmentLen, seg_data = null) {
      super({
        objectMode: true
      });
      this.log = log;
      this.segmentLen = segmentLen;
      this.segments = [];
      this.segment_idx = {};
      this.segmentSeq = (seg_data != null ? seg_data.segmentSeq : void 0) || 0;
      this.discontinuitySeq = (seg_data != null ? seg_data.discontinuitySeq : void 0) || 0;
      this.firstSegment = (seg_data != null ? seg_data.nextSegment : void 0) ? Number(seg_data != null ? seg_data.nextSegment : void 0) : null;
      this.segment_map = (seg_data != null ? seg_data.segmentMap : void 0) || {};
      this.segmentPTS = (seg_data != null ? seg_data.segmentPTS : void 0) || (this.segmentSeq * (this.segmentLen * 90));
      // this starts out the same and diverges backward
      this.discontinuitySeqR = this.discontinuitySeq;
      this._min_ts = null;
    }

    //----------
    expire(ts, cb) {
      var f_s, ref;
      while (true) {
        // expire any segments whose start ts values are at or below this given ts
        if (((f_s = this.segments[0]) != null) && Number(f_s.ts) <= Number(ts)) {
          this.segments.shift();
          delete this.segment_idx[f_s.id];
          this.emit("remove", f_s);
        } else {
          break;
        }
      }
      return cb(null, (ref = this.segments[0]) != null ? ref.id : void 0);
    }

    //----------
    setMinTS(ts, cb) {
      if (ts instanceof Date) {
        ts = Number(ts);
      }
      this._min_ts = ts;
      // Don't expire a segment with this min TS. Send expire a number one lower.
      return this.expire(ts - 1, cb);
    }

    //----------
    dumpMap(cb) {
      var i, len, map, ref, ref1, seg, seg_map;
      seg_map = {};
      ref = this.segments;
      for (i = 0, len = ref.length; i < len; i++) {
        seg = ref[i];
        if (seg.discontinuity == null) {
          seg_map[Number(seg.ts)] = seg.id;
        }
      }
      map = {
        segmentMap: seg_map,
        segmentSeq: this.segmentSeq,
        segmentLen: this.segmentLen,
        segmentPTS: this.segmentPTS,
        discontinuitySeq: this.discontinuitySeq,
        nextSegment: (ref1 = this.segments[this.segments.length - 1]) != null ? ref1.end_ts : void 0
      };
      return cb(null, map);
    }

    //----------
    snapshot(cb) {
      var snapshot;
      snapshot = this.segments.slice(0);
      return cb(null, snapshot);
    }

    //----------
    _write(segment, encoding, cb) {
      var b, data_length, duration, i, last_buf, last_seg, len, seg_id, seg_pts, sorted_buffers;
      // stash our last segment for convenience
      last_seg = this.segments.length > 0 ? this.segments[this.segments.length - 1] : null;
      // -- Compute Segment ID -- #
      seg_id = null;
      seg_pts = null;
      if (this.segment_map[Number(segment.ts)] != null) {
        seg_id = this.segment_map[Number(segment.ts)];
        this.log.debug("Pulling segment ID from loaded segment map", {
          id: seg_id,
          ts: segment.ts
        });
        // don't create a segment we've been told not to have
        if (this._min_ts && segment.end_ts < this._min_ts) {
          this.log.debug("Discarding segment below our minimum TS.", {
            segment_id: seg_id,
            min_ts: this._min_ts
          });
          cb();
          return false;
        }
      } else {
        if ((!last_seg && (!this.firstSegment || Number(segment.ts) > this.firstSegment)) || (last_seg && Number(segment.ts) > Number(last_seg.ts))) {
          seg_id = this.segmentSeq;
          this.segmentSeq += 1;
        } else {
          this.log.debug("Discarding segment without ID from front of buffer.", {
            segment_ts: segment.ts
          });
          cb();
          return false;
        }
      }
      segment.id = seg_id;
      // -- Compute Actual Start, End and Duration -- #
      sorted_buffers = _(segment.buffers).sortBy("ts");
      last_buf = sorted_buffers[sorted_buffers.length - 1];
      segment.ts_actual = sorted_buffers[0].ts;
      segment.end_ts_actual = new Date(Number(last_buf.ts) + last_buf.duration);
      duration = 0;
      data_length = 0;
      for (i = 0, len = sorted_buffers.length; i < len; i++) {
        b = sorted_buffers[i];
        duration += b.duration;
        data_length += b.data.length;
      }
      segment.data_length = data_length;
      segment.duration = duration;
      // we don't need the actual data any more. The HLSIndex will look the
      // data up in the RewindBuffer based on the timestamps
      delete segment.buffers;
      if (Math.abs(segment.ts - segment.ts_actual) > 3000) {
        // FIXME: This logic for this should be based on the target segment duration
        segment.ts = segment.ts_actual;
      }
      if (Math.abs(segment.end_ts - segment.ts_end_actual) > 3000) {
        segment.end_ts = segment.ts_end_actual;
      }
      if (!last_seg || Number(segment.ts) > last_seg.ts) {
        // we're comparing our .ts to last_seg's .end_ts
        segment.discontinuitySeq = !last_seg || segment.ts - last_seg.end_ts === 0 ? this.discontinuitySeq : this.discontinuitySeq += 1;
        // for forward-facing segments, PTS is fetched from the finalizer, and then
        // updated with our duration
        segment.pts = this.segmentPTS;
        this.segmentPTS = Math.round(this.segmentPTS + (segment.duration * 90));
        // if new PTS is above 33-bit max, roll over
        if (this.segmentPTS > MAX_PTS) {
          this.segmentPTS = this.segmentPTS - MAX_PTS;
        }
        this.segments.push(segment);
      } else if (Number(segment.ts) < this.segments[0].ts) {
        // we're comparing our .end_ts to first segment's .ts
        segment.discontinuitySeq = segment.end_ts - this.segments[0].ts === 0 ? this.discontinuitySeqR : this.discontinuitySeqR -= 1;
        // segmentPTS will be the PTS of the following segment, minus our duration
        segment.pts = Math.round(this.segments[0].pts > (segment.duration * 90) ? this.segments[0].pts - (segment.duration * 90) : MAX_PTS - (segment.duration * 90) + this.segments[0].pts);
        this.segments.unshift(segment);
      }
      // add the segment to our index lookup
      this.segment_idx[segment.id] = segment;
      this.emit("add", segment);
      return cb();
    }

  };

  return HLSSegmenter;

}).call(this);

//# sourceMappingURL=hls_segmenter.js.map
