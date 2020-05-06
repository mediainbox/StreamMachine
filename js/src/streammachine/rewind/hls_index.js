var HLSIndex, _;

_ = require("underscore");

module.exports = HLSIndex = (function() {
  class HLSIndex {
    constructor(stream, tz, group) {
      this.stream = stream;
      this.tz = tz;
      this.group = group;
      this._shouldRun = false;
      this._running = false;
      this._segment_idx = {};
      this._segments = [];
      this._segment_length = null;
      this._header = null;
      this._index = null;
      this._short_header = null;
      this._short_index = null;
    }

    //----------
    disconnect() {
      return this.stream = null;
    }

    //----------
    loadSnapshot(snapshot) {
      if (snapshot) {
        this._segments = snapshot.segments;
        this._segment_duration = snapshot.segment_duration;
        return this.queueIndex();
      }
    }

    //----------
    queueIndex() {
      this._shouldRun = true;
      return this._runIndex();
    }

    //----------
    _runIndex() {
      var _after, _short_length, _short_start, b, dseq, has_disc, head, i, id, idx_length, idx_segs, j, k, l, len, len1, len2, len3, m, old_seg_ids, ref, ref1, ref2, s, seg, seg_ids, seg_map, segs, short_head, short_length;
      if (this._running || !this.stream) {
        return false;
      }
      this._running = true;
      this._shouldRun = false;
      _after = () => {
        // -- should we run again? -- #
        this._running = false;
        if (this._shouldRun) {
          return this._runIndex();
        }
      };
      // clone the segments array, in case it changes while we're running
      segs = this._segments.slice(0);
      if (segs.length < 3) {
        // not enough buffer for a playlist yet
        this.header = null;
        this._index = null;
        _after();
        return false;
      }
      // -- Determine Short Index Start -- #
      _short_length = 120 / this._segment_duration;
      _short_start = segs.length - 1 - _short_length;
      if (_short_start < 2) {
        _short_start = 2;
      }
      // -- build our header -- #
      head = Buffer.from(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${this._segment_duration}
#EXT-X-MEDIA-SEQUENCE:${segs[2].id}
#EXT-X-DISCONTINUITY-SEQUENCE:${segs[2].discontinuitySeq}
#EXT-X-INDEPENDENT-SEGMENTS
`);
      short_head = Buffer.from(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${this._segment_duration}
#EXT-X-MEDIA-SEQUENCE:${segs[_short_start].id}
#EXT-X-DISCONTINUITY-SEQUENCE:${segs[_short_start].discontinuitySeq}
#EXT-X-INDEPENDENT-SEGMENTS
`);
      // run through segments and build the index
      // We skip the first three segments for the index, but we'll use
      // segment #2 for our next ts
      idx_segs = [];
      idx_length = 0;
      // what ids are in this segment list?
      seg_ids = (function() {
        var j, len, results;
        results = [];
        for (j = 0, len = segs.length; j < len; j++) {
          seg = segs[j];
          results.push(String(seg.id));
        }
        return results;
      })();
      // -- loop through remaining segments -- #
      dseq = segs[1].discontinuitySeq;
      ref = segs.slice(2);
      for (i = j = 0, len = ref.length; j < len; i = ++j) {
        seg = ref[i];
        if (!this._segment_idx[seg.id]) {
          // is the segment where we expect it in the timeline?
          has_disc = !(seg.discontinuitySeq === dseq);
          seg.idx_buffer = Buffer.from(`${has_disc ? "#EXT-X-DISCONTINUITY\n" : ""}#EXTINF:${seg.duration / 1000},
#EXT-X-PROGRAM-DATE-TIME:${this.tz(seg.ts_actual, "%FT%T.%3N%:z")}
/${this.stream.key}/ts/${seg.id}.${this.stream.opts.format}`);
          this._segment_idx[seg.id] = seg;
        }
        b = this._segment_idx[seg.id].idx_buffer;
        idx_length += b.length;
        idx_segs.push(b);
        dseq = seg.discontinuitySeq;
      }
      // -- build the segment map -- #
      seg_map = {};
      for (k = 0, len1 = segs.length; k < len1; k++) {
        s = segs[k];
        seg_map[s.id] = s;
      }
      // -- set these as active -- #
      this._header = head;
      this._index = idx_segs;
      this._index_length = idx_length;
      this._short_header = short_head;
      this._short_index = idx_segs.slice(_short_start);
      short_length = 0;
      ref1 = this._short_index;
      for (l = 0, len2 = ref1.length; l < len2; l++) {
        b = ref1[l];
        short_length += b.length;
      }
      this._short_length = short_length;
      // what segments should be removed from our index?
      old_seg_ids = Object.keys(this._segment_idx);
      ref2 = _(old_seg_ids).difference(seg_ids);
      for (m = 0, len3 = ref2.length; m < len3; m++) {
        id = ref2[m];
        if (this._segment_idx[id]) {
          delete this._segment_idx[id];
        }
      }
      return _after();
    }

    //----------
    short_index(session, cb) {
      var writer;
      session = session ? Buffer.from(session + "\n") : Buffer.from("\n");
      if (!this._short_header) {
        return cb(null, null);
      }
      writer = new HLSIndex.Writer(this._short_header, this._short_index, this._short_length, session);
      return cb(null, writer);
    }

    //----------
    index(session, cb) {
      var writer;
      session = session ? Buffer.from(session + "\n") : Buffer.from("\n");
      if (!this._header) {
        return cb(null, null);
      }
      writer = new HLSIndex.Writer(this._header, this._index, this._index_length, session);
      return cb(null, writer);
    }

    //----------
    pumpSegment(rewinder, id, cb) {
      var dur, s;
      // given a segment id, look the segment up in our store to get start ts
      // and duration, then ask the RewindBuffer for the appropriate data
      if (s = this._segment_idx[Number(id)]) {
        // valid segment...
        dur = this.stream.secsToOffset(s.duration / 1000);
        return this.stream.pumpFrom(rewinder, s.ts_actual, dur, false, (err, info) => {
          if (err) {
            return cb(err);
          } else {
            return cb(null, _.extend(info, {
              pts: s.pts
            }));
          }
        });
      } else {
        return cb("Segment not found in index.");
      }
    }

  };

  //----------
  HLSIndex.Writer = class Writer extends require("stream").Readable {
    constructor(header, index, ilength, session1) {
      super();
      this.header = header;
      this.index = index;
      this.ilength = ilength;
      this.session = session1;
      this._sentHeader = false;
      this._idx = 0;
      // determine total length
      this._length = this.header.length + this.ilength + (this.session.length * this.index.length);
    }

    length() {
      return this._length;
    }

    _read(size) {
      var bufs, sent;
      sent = 0;
      bufs = [];
      if (!this._sentHeader) {
        bufs.push(this.header);
        this._sentHeader = true;
        sent += this.header.length;
      }
      while (true) {
        bufs.push(this.index[this._idx]);
        bufs.push(this.session);
        sent += this.index[this._idx].length;
        sent += this.session.length;
        this._idx += 1;
        if ((sent > size) || this._idx === this.index.length) {
          break;
        }
      }
      this.push(Buffer.concat(bufs, sent));
      if (this._idx === this.index.length) {
        return this.push(null);
      }
    }

  };

  return HLSIndex;

}).call(this);

//# sourceMappingURL=hls_index.js.map
