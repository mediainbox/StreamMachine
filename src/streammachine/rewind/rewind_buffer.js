const _ = require("lodash");
const Rewinder = require("./rewinder");
const MemoryStore = require("./store/memory_store");
const RewindWriter = require('./rewind_writer');
const {toTime} = require('../../helpers/datetime');
const {passthrough, BetterEventEmitter} = require('../events');

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
    RESET: 'reset',
    PRELOAD_START: 'PRELOAD_START',
    PRELOAD_DONE: 'PRELOAD_DONE',
  }

  source = null;
  vitals = {
    streamKey: null,
    framesPerSecond: null,
    secondsPerChunk: null,
  }
  buffer = new MemoryStore();
  maxChunks = null;
  preloading = false;
  rewinders = [];

  /**
   * args: {
   *   id: rewind id (user for dump)
   *   streamKey: stream key
   *   maxSeconds: max buffer seconds
   *   initialBurst: seconds to burst before
   *   vitals?: {
   *     streamKey
   *     framesPerSecond
   *     secondsPerChunk
   *   }
   *   logger
   * }
   */
  constructor({ id, streamKey, vitals, maxSeconds, initialBurst, logger }) {
    super();

    this.logger = logger.child({
      component: `stream[${streamKey}]:rewind_buffer`
    });

    this.id = id;
    this.streamKey = streamKey;
    this.maxSeconds = maxSeconds || 0;
    this.initialBurst = initialBurst;

    if (vitals) {
      this.vitals = vitals;
    }

    this.hookEvents();
  }

  hookEvents() {
    passthrough(['shift', 'push', 'unshift'], this.buffer, this);
  }

  push = (chunk) => {
    if (this.disconnected) {
      return;
    }

    this.logger.silly(`insert chunk ${toTime(chunk.ts)} in buffer`);
    this.buffer.insert(chunk);

    this.rewinders.forEach(rewinder => {
      // we'll give them whatever is at length - offset
      // FIXME: This lookup strategy is horribly inefficient
      this.buffer.at(rewinder.getOffset(), (err, b) => {
        return rewinder._insert(b);
      });
    });
  };

  // TODO: check
  connectSource = (source) => {
    if (this.source) {
      this.source.removeListener("data", this.push);
      this.logger.debug("removed old rewind data listener");
    }

    this.source = source;

    source.vitals((err, vitals) => {
      if (this.vitals.streamKey && this.vitals.streamKey === vitals.streamKey) {
        this.logger.debug("rewind buffer validated new source, keep current buffer");
      } else {
        this.updateVitals({
          // TODO: standarize globally
          streamKey: vitals.streamKey,
          framesPerSecond: vitals.framesPerSec,
          secondsPerChunk: vitals.emitDuration
        });
      }

      source.on("data", this.push);
    });
  }

  updateVitals(vitals) {
    if (!this.vitals.streamKey) {
      this.logger.info("initial vitals received", { vitals });
      this.vitals = vitals;
      this.adjustBufferSize();
      return;
    }

    if (this.vitals.streamKey !== vitals.streamKey) {
      // if it's a reconnection, but didn't match rate
      // it should wipe out the old buffer
      if (vitals.streamKey) {
        this.logger.warn("incompatile existing buffer vitals, resetting", {
          newVitals: vitals,
          currentVitals: this.vitals,
        });
        this.buffer.reset();
      } else {
        this.vitals = _.mergeWith(
          {}, this.vitals, vitals,
          (oldVal, newVal) => !newVal ? oldVal : newVal
        )
      }

      this.adjustBufferSize();
      return;
    }

    this.logger.info("compatible vitals received");
  }

  setRewind(maxSeconds, burstSecs) {
    this.maxSeconds = maxSeconds;
    return this.adjustBufferSize();
  }

  adjustBufferSize() {
    if (this.vitals.secondsPerChunk) {
      this.maxChunks = Math.round(this.maxSeconds / this.vitals.secondsPerChunk);
      this.buffer.setMaxLength(this.maxChunks);
    }

    this.logger.info(`buffer adjusted, max length is ${this.maxSeconds} seconds (${this.maxChunks} chunks)`);
  }

  async getRewinder(id, opts) {
    const rewind = new Rewinder(this, opts);

    if (!opts.pumpOnly) {
      // add it to our list of listeners
      this.addRewinder(rewind);
    }

    await rewind.start();
    return rewind;
  }

  // Load a RewindBuffer.  Buffer should arrive newest first, which means
  // that we can simply shift() it into place and don't have to lock out
  // any incoming data.
  preload(loader, cb) {
    this.preloading = true;
    this.emit(RewindBuffer.EVENTS.PRELOAD_START);

    let firstData = true;
    loader
      .on('readable', () => {
        let chunk;

        while (chunk = loader.read()) {
          if (firstData) {
            this.emit("header", chunk);
            this.updateVitals({
              streamKey: chunk.stream_key,
              secondsPerChunk: chunk.secs_per_chunk,
            });
            firstData = false;
          } else {
            // Insert a chunk into the RewindBuffer. Inserts can only go backward, so
            // the timestamp must be less than @buffer[0].ts for a valid chunk
            this.buffer.insert(chunk);
            //this.emit("buffer", chunk);
          }
        }
      })
      .on('error', err => {
        this.preloading = false;
        this.logger.error('error ocurred while preloading', { err })
        this.emit(RewindBuffer.EVENTS.PRELOAD_DONE);
        cb();
      })
      .on('end', () => {
        this.preloading = false;
        this.logger.info(`preload finished, loaded ${this.getBufferedSeconds()} seconds (${this.buffer.length()} chunks)`);
        this.emit(RewindBuffer.EVENTS.PRELOAD_DONE);
        cb();
      });
  }

  validateSecondsOffset(seconds) {
    return this.validateOffset(this.secondsToOffset(seconds));
  }

  validateOffset(offset) {
    const bufferedLength = this.buffer.length();

    if (offset < 0) {
      this.logger.debug("offset is invalid, must be at least 0 for live audio", {
        offset
      });
      return 0;
    }

    if (bufferedLength >= offset) {
      return offset;
    }

    this.logger.debug("offset not available, instead giving max offset", {
      offset,
    });

    return bufferedLength - 1;
  }

  pumpSeconds(rewinder, seconds, concat, cb) {
    var frames;
    // pump the most recent X seconds
    frames = this.validateSecondsOffset(seconds);
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
      offsetSeconds = offset instanceof Date ? (Number(this.buffer.last().ts) - Number(offset)) / 1000 : this.offsetToSeconds(offset);
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
    burst = this.validateSecondsOffset(burstSecs);
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

  addRewinder(rewinder) {
    if (rewinder.getOffset() < 0) {
      // FIXME: ??? see -1 in rewinder
      this.logger.error(`can not add rewinder with negative offset`);
      return;
    }

    this.rewinders.push(rewinder);
  }

  removeRewinder(rewinder) {
    this.rewinders = this.rewinders.slice(0).filter(l => l !== rewinder);
  }

  disconnect() {
    this.disconnected = true;
    this.removeAllListeners();
    this.buffer.removeAllListeners();
  }

  isLoading() {
    return this.loading;
  }

  reset() {
    this.buffer.reset();
    this.emit(RewindBuffer.EVENTS.RESET);
  }

  getStatus() {
    return {
      buffer_length: this.buffer.length(),
      first_buffer_ts: _.get(this.buffer.first(), 'ts', null),
      last_buffer_ts: _.get(this.buffer.last(), 'ts', null)
    };
  }

  // convert buffered length to seconds
  getBufferedSeconds() {
    return Math.round(this.buffer.length() * this.vitals.secondsPerChunk);
  }

  secondsToOffset(secs) {
    return Math.round(Number(secs) / this.vitals.secondsPerChunk);
  }

  offsetToSeconds(offset) {
    return Math.round(Number(offset) * this.vitals.secondsPerChunk);
  }

  // TODO: move away
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
        writer = new RewindWriter(rbuf_copy, this.vitals.secondsPerChunk, this.audioKey, hls);
        return cb(null, writer);
      };
      return go();
    });
  }
};
