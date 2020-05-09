var Concentrate, Dissolve, MemoryStore, RewindBuffer, Rewinder, _, nconf;

_ = require('underscore');

Concentrate = require("concentrate");

Dissolve = require("dissolve");

nconf = require("nconf");

Rewinder = require("./rewinder");

MemoryStore = require("./memory_store");

// RewindBuffer supports play from an arbitrary position in the last X hours
// of our stream.

// Buffer is an array of objects. Each object should have:
// * ts:         Timestamp for when chunk was emitted from master stream
// * data:       Chunk of audio data (in either MP3 or AAC)
// * meta:       Metadata that should be running as of this chunk
// * duration:   Duration of the audio chunk

// When the buffer is dumped, it will be in the form of a loop of binary
// packets.  Each will contain:
// * uint8: metadata length
// * Buffer: metadata, stringified into JSON and stuck in a buffer (obj is ts,
//   duration and meta)
// * uint16: data length
// * Buffer: data chunk
module.exports = RewindBuffer = (function() {
  class RewindBuffer extends require("events").EventEmitter {
    constructor(args = {}) {
      super();
      this.opts = args
      this.onListen = args.onListen;
      this.onListenerDisconnect = args.onListenerDisconnect;
      this.logger = args.logger.child({
        component: `stream[${args.station}]:rewind_buffer`
      });

      // FIXME: accessed by rewinder.....
      this.seconds = args.seconds;
      this.burst = args.burst;
      this._rsecs = args.seconds || 0;
      this._rburstsecs = args.burst || 0;


      this._rsecsPerChunk = 2e308;
      this._rmax = null;
      this._rburst = null;
      this._rkey = args.key;
      this._risLoading = false;
      // each listener should be an object that defines obj._offset and
      // obj.writeFrame. We implement RewindBuffer.Listener, but other
      // classes can work with those pieces
      this._rlisteners = [];
      // -- instantiate our memory buffer -- #
      this._rbuffer = args.buffer_store || new MemoryStore();
      this._rbuffer.on("shift", (b) => {
        return this.emit("rshift", b);
      });
      this._rbuffer.on("push", (b) => {
        return this.emit("rpush", b);
      });
      this._rbuffer.on("unshift", (b) => {
        return this.emit("runshift", b);
      });
      // -- set up header and frame functions -- #
      this._rdataFunc = (chunk) => {
        var i, l, len, ref, results;
        // push the chunk on the buffer
        this._rbuffer.insert(chunk);
        ref = this._rlisteners;
        // loop through all connected listeners and pass the frame buffer at
        // their offset.
        results = [];
        for (i = 0, len = ref.length; i < len; i++) {
          l = ref[i];
          // we'll give them whatever is at length - offset
          // FIXME: This lookup strategy is horribly inefficient
          results.push(this._rbuffer.at(l._offset, (err, b) => {
            return l._insert(b);
          }));
        }
        return results;
      };
    }

    //----------
    disconnect() {
      this._rdataFunc = function() {};
      this._rbuffer.removeAllListeners();
      return true;
    }

    //----------
    isLoading() {
      return this._risLoading;
    }

    //----------
    resetRewind(cb) {
      this._rbuffer.reset(cb);
      return this.emit("reset");
    }

    //----------
    setRewind(secs, burst) {
      this._rsecs = secs;
      this._rburstsecs = burst;
      return this._rUpdateMax();
    }

    //----------
    _rConnectSource(newsource, cb) {
      this.logger.debug("connect buffer to received source");

      // -- disconnect from old source -- #
      if (this._rsource) {
        this._rsource.removeListener("data", this._rdataFunc);
        this.logger.debug("removed old rewind data listener");
      }
      // -- compute initial stats -- #
      return newsource.vitals((err, vitals) => {
        if (this._rstreamKey && this._rstreamKey === vitals.streamKey) {
          // reconnecting, but rate matches so we can keep using
          // our existing buffer.
          this.logger.debug("Rewind buffer validated new source.  Reusing buffer.");
        } else {
          this._rChunkLength(vitals);
        }
        // connect our data listener
        newsource.on("data", this._rdataFunc);
        // keep track of our source
        this._rsource = newsource;
        return typeof cb === "function" ? cb(null) : void 0;
      });
    }

    //----------

      // Return rewind buffer status, including HTTP Live Streaming if enabled
    _rStatus() {
      var ref, ref1, status;
      status = {
        buffer_length: this._rbuffer.length(),
        first_buffer_ts: (ref = this._rbuffer.first()) != null ? ref.ts : void 0,
        last_buffer_ts: (ref1 = this._rbuffer.last()) != null ? ref1.ts : void 0
      };
      return status;
    }

    //----------
    _rChunkLength(vitals) {
      if (this._rstreamKey !== vitals.streamKey) {
        if (this._rstreamKey) {
          // we're reconnecting, but didn't match rate...  we
          // should wipe out the old buffer
          this.logger.debug("Invalid existing rewind buffer. Reset.");
          this._rbuffer.reset();
        }
        // compute new frame numbers
        this._rsecsPerChunk = vitals.emitDuration;
        this._rstreamKey = vitals.streamKey;
        this._rUpdateMax();
      }
    }

    //----------
    _rUpdateMax() {
      if (this._rsecsPerChunk) {
        this._rmax = Math.round(this._rsecs / this._rsecsPerChunk);
        this._rbuffer.setMax(this._rmax);
        this._rburst = Math.round(this._rburstsecs / this._rsecsPerChunk);
      }

      return this.logger.debug(`rewind max buffer length is at ${this._rmax} chunks (${this._rsecs} seconds) `);
    }

    //----------
    getRewinder(id, opts, cb) {
      var rewind;
      // create a rewinder object
      rewind = new Rewinder(this, id, opts, cb);
      if (!opts.pumpOnly) {
        // add it to our list of listeners
        return this._raddListener(rewind);
      }
    }

    //----------
    recordListen(opts) {
      this.onListen && this.onListen(opts);
    }

    disconnectListener(connectionId) {
      this.onListenerDisconnect && this.onListenerDisconnect(connectionId);
    }

    // stub function. must be defined for real in the implementing class

      //----------
    bufferedSecs() {
      // convert buffer length to seconds
      return Math.round(this._rbuffer.length() * this._rsecsPerChunk);
    }

    //----------

      // Insert a chunk into the RewindBuffer. Inserts can only go backward, so
    // the timestamp must be less than @_rbuffer[0].ts for a valid chunk
    _insertBuffer(chunk) {
      return this._rbuffer.insert(chunk);
    }

    //----------

      // Load a RewindBuffer.  Buffer should arrive newest first, which means
    // that we can simply shift() it into place and don't have to lock out
    // any incoming data.
    loadBuffer(stream, cb) {
      var headerRead, parser;
      this._risLoading = true;
      this.emit("rewind_loading");
      if (!stream) {
        // Calling loadBuffer with no stream is really just for testing
        process.nextTick(() => {
          this.emit("rewind_loaded");
          return this._risLoading = false;
        });
        return cb(null, {
          seconds: 0,
          length: 0
        });
      }
      parser = Dissolve().uint32le("header_length").tap(function() {
        return this.buffer("header", this.vars.header_length).tap(function() {
          this.push(JSON.parse(this.vars.header));
          this.vars = {};
          return this.loop(function(end) {
            return this.uint8("meta_length").tap(function() {
              return this.buffer("meta", this.vars.meta_length).uint16le("data_length").tap(function() {
                return this.buffer("data", this.vars.data_length).tap(function() {
                  var meta;
                  meta = JSON.parse(this.vars.meta.toString());
                  this.push({
                    ts: new Date(meta.ts),
                    meta: meta.meta,
                    duration: meta.duration,
                    data: this.vars.data
                  });
                  return this.vars = {};
                });
              });
            });
          });
        });
      });
      stream.pipe(parser);
      headerRead = false;
      parser.on("readable", () => {
        var c, results;
        results = [];
        while (c = parser.read()) {
          if (!headerRead) {
            headerRead = true;
            this.emit("header", c);
            this._rChunkLength({
              emitDuration: c.secs_per_chunk,
              streamKey: c.stream_key
            });
          } else {
            this._insertBuffer(c);
            this.emit("buffer", c);
          }
          results.push(true);
        }
        return results;
      });
      return parser.on("end", () => {
        var obj;
        obj = {
          seconds: this.bufferedSecs(),
          length: this._rbuffer.length()
        };
        this.logger.info(`rewind buffer is now at ${obj.seconds} seconds and ${obj.length} bytes`);
        this.emit("rewind_loaded");
        this._risLoading = false;
        return typeof cb === "function" ? cb(null, obj) : void 0;
      });
    }

    //----------

      // Dump the rewindbuffer. We want to dump the newest data first, so that
    // means running back from the end of the array to the front.
    dumpBuffer(cb) {
      // taking a copy of the array should effectively freeze us in place
      return this._rbuffer.clone((err, rbuf_copy) => {
        var go;
        if (err) {
          cb(err);
          return false;
        }
        go = (hls) => {
          var writer;
          writer = new RewindBuffer.RewindWriter(rbuf_copy, this._rsecsPerChunk, this._rstreamKey, hls);
          return cb(null, writer);
        };
        return go();
      });
    }

    //----------
    checkOffsetSecs(secs) {
      return this.checkOffset(this.secsToOffset(secs));
    }

    //----------
    checkOffset(offset) {
      var bl;
      bl = this._rbuffer.length();
      if (offset < 0) {
        this.logger.debug("offset is invalid! 0 for live.");
        return 0;
      }
      if (bl >= offset) {
        this.logger.debug("Granted. current buffer length is ", {
          length: bl
        });
        return offset;
      } else {
        this.logger.debug("Not available. Instead giving max buffer of ", {
          length: bl - 1
        });
        return bl - 1;
      }
    }

    //----------
    secsToOffset(secs) {
      return Math.round(Number(secs) / this._rsecsPerChunk);
    }

    //----------
    offsetToSecs(offset) {
      return Math.round(Number(offset) * this._rsecsPerChunk);
    }

    //----------
    timestampToOffset(time, cb) {
      return cb(null, this._rbuffer._findTimestampOffset(time));
    }

    //----------
    pumpSeconds(rewinder, seconds, concat, cb) {
      var frames;
      // pump the most recent X seconds
      frames = this.checkOffsetSecs(seconds);
      return this.pumpFrom(rewinder, frames, frames, concat, cb);
    }

    //----------
    pumpFrom(rewinder, offset, length, concat, cb) {
      // we want to send _length_ chunks, starting at _offset_
      if (offset === 0 || length === 0) {
        if (typeof cb === "function") {
          cb(null, null);
        }
        return true;
      }
      return this._rbuffer.range(offset, length, (err, chunks) => {
        var b, buffers, cbuf, duration, i, len, meta, offsetSeconds, pumpLen, ref;
        pumpLen = 0;
        duration = 0;
        meta = null;
        buffers = [];
        for (i = 0, len = chunks.length; i < len; i++) {
          b = chunks[i];
          pumpLen += b.data.length;
          duration += b.duration;
          if (concat) {
            buffers.push(b.data);
          } else {
            rewinder._insert(b);
          }
          if (!meta) {
            meta = b.meta;
          }
        }
        if (concat) {
          cbuf = Buffer.concat(buffers);
          rewinder._insert({
            data: cbuf,
            meta: meta,
            duration: duration
          });
        }
        // how many seconds are between this date and the end of the
        // buffer?
        offsetSeconds = offset instanceof Date ? (Number(this._rbuffer.last().ts) - Number(offset)) / 1000 : this.offsetToSecs(offset);
        if ((ref = this.log) != null) {
          ref.debug("Converting offset to seconds: ", {
            offset: offset,
            secs: offsetSeconds
          });
        }
        return typeof cb === "function" ? cb(null, {
          meta: meta,
          duration: duration,
          length: pumpLen,
          offsetSeconds: offsetSeconds
        }) : void 0;
      });
    }

    //----------
    burstFrom(rewinder, offset, burstSecs, cb) {
      var burst;
      // we want to send them @burst frames (if available), starting at offset.
      // return them the new offset position and the burst data

      // convert burstSecs to frames
      burst = this.checkOffsetSecs(burstSecs);
      if (offset > burst) {
        return this.pumpFrom(rewinder, offset, burst, false, (err, info) => {
          return typeof cb === "function" ? cb(err, offset - burst) : void 0;
        });
      } else {
        return this.pumpFrom(rewinder, offset, offset, false, (err, info) => {
          return typeof cb === "function" ? cb(err, 0) : void 0;
        });
      }
    }

    //----------
    _raddListener(obj) {
      if ((obj._offset != null) && obj._offset >= 0) {
        this._rlisteners.push(obj);
        return true;
      } else {
        return false;
      }
    }

    //----------
    _rremoveListener(obj) {
      this._rlisteners = _(this._rlisteners).without(obj);
      return true;
    }

  };

  //----------
  RewindBuffer.RewindWriter = class RewindWriter extends require("stream").Readable {
    constructor(buf, secs1, streamKey, hls1) {
      super({
        highWaterMark: 25 * 1024 * 1024
      });
      this.buf = buf;
      this.secs = secs1;
      this.streamKey = streamKey;
      this.hls = hls1;
      this.c = Concentrate();
      this.slices = 0;
      this.i = this.buf.length - 1;
      this._ended = false;
      // make sure there's something to send
      if (this.buf.length === 0) {
        this.push(null);
      } else {
        this._writeHeader();
      }
    }

    //----------
    _writeHeader(cb) {
      var header_buf;
      // -- Write header -- #
      header_buf = Buffer.from(JSON.stringify({
        start_ts: this.buf[0].ts,
        end_ts: this.buf[this.buf.length - 1].ts,
        secs_per_chunk: this.secs,
        stream_key: this.streamKey,
        hls: this.hls
      }));
      // header buffer length
      this.c.uint32le(header_buf.length);
      // header buffer json
      this.c.buffer(header_buf);
      this.push(this.c.result());
      return this.c.reset();
    }

    //----------
    _read(size) {
      var chunk, meta_buf, r, result, wlen;
      if (this.i < 0) {
        return false;
      }
      // -- Data Chunks -- #
      wlen = 0;
      while (true) {
        chunk = this.buf[this.i];
        meta_buf = Buffer.from(JSON.stringify({
          ts: chunk.ts,
          meta: chunk.meta,
          duration: chunk.duration
        }));
        // 1) metadata length
        this.c.uint8(meta_buf.length);
        // 2) metadata json
        this.c.buffer(meta_buf);
        // 3) data chunk length
        this.c.uint16le(chunk.data.length);
        // 4) data chunk
        this.c.buffer(chunk.data);
        r = this.c.result();
        this.c.reset();
        result = this.push(r);
        wlen += r.length;
        this.i -= 1;
        if (this.i < 0) {
          // finished
          this.push(null);
          return true;
        }
        if (!result || wlen > size) {
          return false;
        }
      }
    }

  };

  return RewindBuffer;

}).call(this);

// otherwise loop again
