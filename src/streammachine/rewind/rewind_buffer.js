const _ = require("lodash");
const Dissolve = require("dissolve");
const Rewinder = require("./rewinder");
const MemoryStore = require("./store/memory_store");
const RewindWriter = require('./rewind_writer');
const { passthrough, BetterEventEmitter } = require('../events');

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
module.exports = class RewindBuffer extends BetterEventEmitter {
  static EVENTS = {
    RESET: 'reset'
  }

  constructor(args = {}) {
    super();

    this.opts = args
    this.logger = args.logger.child({
      component: `stream[${args.station}]:rewind_buffer`
    });

    // FIXME: accessed by rewinder.....
    this.seconds = args.seconds;
    this.burst = args.burst;
    this.maxSeconds = args.seconds || 0;

    this.configured = false;
    this._rstreamKey = null;
    this.secondsPerChunk = Infinity;
    this.maxChunks = null;
    this._rkey = args.key;
    this.loading = false;

    this.rewinders = [];

    // -- instantiate our memory buffer -- #
    this.buffer = new MemoryStore();

    this.hookEvents();
  }

  hookEvents() {
    passthrough(['shift', 'push', 'unshift'], this.buffer, this);
  }

  push = (chunk) => {
    if (this.disconnected) {
      return;
    }

    this.buffer.insert(chunk);

    const results = [];
    this.rewinders.forEach(rewinder => {
      // we'll give them whatever is at length - offset
      // FIXME: This lookup strategy is horribly inefficient
      results.push(this.buffer.at(rewinder.offset(), (err, b) => {
        return rewinder._insert(b);
      }));
    });

    return results;
  };

  isLoading() {
    return this.loading;
  }

  reset(cb) {
    this.buffer.reset(cb);
    this.emit(RewindBuffer.EVENTS.RESET);
  }

  setRewind(secs, burstSecs) {
    this.maxSeconds = secs;
    return this._rUpdateMax();
  }

  _rConnectSource = (newsource, cb) => {
    this.logger.debug("RewindBuffer got source event");
    if (this._rsource) {
      this._rsource.removeListener("data", this.push);
      this.logger.debug("removed old rewind data listener");
    }
    return newsource.vitals((function (_this) {
      return function (err, vitals) {
        if (_this._rstreamKey && _this._rstreamKey === vitals.streamKey) {
          _this.logger.debug("Rewind buffer validated new source.  Reusing buffer.");
        } else {
          _this._rChunkLength(vitals);
        }
        newsource.on("data", _this.push);
        _this._rsource = newsource;
        return typeof cb === "function" ? cb(null) : void 0;
      };
    })(this));
  }



  // Return rewind buffer status, including HTTP Live Streaming if enabled
  _rStatus() {
    var ref, ref1, status;
    status = {
      buffer_length: this.buffer.length(),
      first_buffer_ts: (ref = this.buffer.first()) != null ? ref.ts : void 0,
      last_buffer_ts: (ref1 = this.buffer.last()) != null ? ref1.ts : void 0
    };
    return status;
  }

  _rChunkLength(vitals) {
    if (this._rstreamKey !== vitals.streamKey) {
      if (this._rstreamKey) {
        // we're reconnecting, but didn't match rate...  we
        // should wipe out the old buffer
        this.logger.debug("Invalid existing rewind buffer. Reset.");
        this.buffer.reset();
      }
      // compute new frame numbers
      this.secondsPerChunk = vitals.emitDuration;
      this._rstreamKey = vitals.streamKey;
      this._rUpdateMax();
    }
  }

  _rUpdateMax() {
    if (this.secondsPerChunk) {
      this.maxChunks = Math.round(this.maxSeconds / this.secondsPerChunk);
      this.buffer.setMax(this.maxChunks);
    }

    this.logger.info(`rewind max buffer length is ${this.maxSeconds} seconds (${this.maxChunks} chunks)`);
  }

  getRewinder(id, opts, cb) {
    var rewind;
    // create a rewinder object
    rewind = new Rewinder(this, id, opts, cb);
    if (!opts.pumpOnly) {
      // add it to our list of listeners
      return this.addRewinder(rewind);
    }
  }

  bufferedSecs() {
    // convert buffer length to seconds
    return Math.round(this.buffer.length() * this.secondsPerChunk);
  }

  // Insert a chunk into the RewindBuffer. Inserts can only go backward, so
  // the timestamp must be less than @buffer[0].ts for a valid chunk
  _insertBuffer(chunk) {
    return this.buffer.insert(chunk);
  }

  preload(loader, cb) {
    this.loading = true;
    this.emit("rewind_loading");

    loader
      .on('readable', () => {
        let c;
        const results = [];

        while (c = parser.read()) {
          if (!results.length) {
            // empty results, it's header
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
      })
      .on('end', () => {
        var obj;
        obj = {
          seconds: this.bufferedSecs(),
          length: this.buffer.length()
        };
        this.logger.info(`rewind buffer received has ${obj.seconds} seconds (${obj.length} chunks)`);
        this.emit("rewind_loaded");
        this.loading = false;
      })
      .on('error', () => {
        this.loading = false;
        this.emit("rewind_loaded");
      });
  }


  // Load a RewindBuffer.  Buffer should arrive newest first, which means
  // that we can simply shift() it into place and don't have to lock out
  // any incoming data.
  loadBuffer(stream, cb) {
    var headerRead, parser;
    this.loading = true;
    this.emit("rewind_loading");
    if (!stream) {
      // Calling loadBuffer with no stream is really just for testing
      process.nextTick(() => {
        this.emit("rewind_loaded");
        return this.loading = false;
      });
      return cb(null, {
        seconds: 0,
        length: 0
      });
    }
    parser = Dissolve().uint32le("header_length").tap(function () {
      return this.buffer("header", this.vars.header_length).tap(function () {
        this.push(JSON.parse(this.vars.header));
        this.vars = {};
        return this.loop(function (end) {
          return this.uint8("meta_length").tap(function () {
            return this.buffer("meta", this.vars.meta_length).uint16le("data_length").tap(function () {
              return this.buffer("data", this.vars.data_length).tap(function () {
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
        length: this.buffer.length()
      };
      this.logger.info(`rewind buffer received has ${obj.seconds} seconds (${obj.length} chunks)`);
      this.emit("rewind_loaded");
      this.loading = false;
      return typeof cb === "function" ? cb(null, obj) : void 0;
    });
  }


  // Dump the rewindbuffer. We want to dump the newest data first, so that
  // means running back from the end of the array to the front.
  dumpBuffer(cb) {
    // taking a copy of the array should effectively freeze us in place
    return this.buffer.clone((err, rbuf_copy) => {
      var go;
      if (err) {
        cb(err);
        return false;
      }
      go = (hls) => {
        var writer;
        writer = new RewindWriter(rbuf_copy, this.secondsPerChunk, this._rstreamKey, hls);
        return cb(null, writer);
      };
      return go();
    });
  }

  checkOffsetSecs(secs) {
    return this.checkOffset(this.secsToOffset(secs));
  }

  checkOffset(offset) {
    var bl;
    bl = this.buffer.length();
    if (offset < 0) {
      this.logger.debug("offset is invalid! 0 for live.");
      return 0;
    }
    if (bl >= offset) {
      this.logger.silly("Granted. current buffer length is ", {
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

  secsToOffset(secs) {
    return Math.round(Number(secs) / this.secondsPerChunk);
  }

  offsetToSecs(offset) {
    return Math.round(Number(offset) * this.secondsPerChunk);
  }

  pumpSeconds(rewinder, seconds, concat, cb) {
    var frames;
    // pump the most recent X seconds
    frames = this.checkOffsetSecs(seconds);
    return this.pumpFrom(rewinder, frames, frames, concat, cb);
  }

  pumpFrom(rewinder, offset, length, concat, cb) {
    // we want to send _length_ chunks, starting at _offset_
    if (offset === 0 || length === 0) {
      if (typeof cb === "function") {
        cb(null, null);
      }
      return true;
    }
    return this.buffer.range(offset, length, (err, chunks) => {
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
      offsetSeconds = offset instanceof Date ? (Number(this.buffer.last().ts) - Number(offset)) / 1000 : this.offsetToSecs(offset);
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

  addRewinder(obj) {
    if (obj.offset() < 0) {
      // FIXME: ??? see -1 in rewinder
      this.logger.error(`can not add rewinder with negative offset`);
      return;
    }

    this.rewinders.push(obj);
  }

  removeRewinder(rewinder) {
    this.rewinders = this.rewinders.slice(0).filter(l => l !== rewinder);
  }

  disconnect() {
    this.disconnected = true;
    this.buffer.removeAllListeners();
  }
};
