var Rewinder, _, debug,
  boundMethodCheck = function(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new Error('Bound instance method accessed before binding'); } };

_ = require("underscore");

debug = require("debug")("sm:rewind:rewinder");

// Rewinder is the general-purpose listener stream.
// Arguments:
// * offset: Number
//   - Where to position the playHead relative to now.  Should be a positive
//     number representing the number of seconds behind live
// * pump: Boolean||Number
//   - If true, burst 30 seconds or so of data as a buffer. If offset is 0,
//     that 30 seconds will effectively put the offset at 30. If offset is
//     greater than 0, burst will go forward from that point.
//   - If a number, specifies the number of seconds of data to pump
//     immediately.
// * pumpOnly: Boolean, default false
//   - Don't hook the Rewinder up to incoming data. Pump whatever data is
//     requested and then send EOF
module.exports = Rewinder = class Rewinder extends require("stream").Readable {
  constructor(rewind, conn_id, opts = {}, cb) {
    var finalizeFunc, oFunc, offset;
    super({
      highWaterMark: 256 * 1024
    });
    //----------

    // Implement the guts of the Readable stream. For a normal stream,
    // RewindBuffer will be calling _insert at regular ticks to put content
    // into our queue, and _read takes the task of buffering and sending
    // that out to the listener.
    this._read = this._read.bind(this);
    //----------
    this._insert = this._insert.bind(this);
    this.rewind = rewind;
    this.conn_id = conn_id;
    // keep track of the duration of the segments we have pushed
    // Note that for non-pump requests, these will be reset periodically
    // as we report listening segments
    this._sentDuration = 0;
    this._sentBytes = 0;
    this._offsetSeconds = null;
    this._contentTime = null;
    this._pumpOnly = false;
    this._offset = -1;
    this._queue = [];
    this._queuedBytes = 0;
    this._reading = false;
    this._bounceRead = _.debounce(() => {
      return this.read(0);
    }, 100);
    this._segTimer = null;
    this.pumpSecs = opts.pump === true ? this.rewind.opts.burst : opts.pump;
    finalizeFunc = (...args) => {
      if (!this._pumpOnly) {
        // for non-pump requests, we want to set a timer that will
        // log a segment every 30 seconds. This allows us to use the
        // same analytics pipeline as we do for HLS pumped data
        this._segTimer = setInterval(() => {
          var obj;
          obj = {
            id: this.conn_id,
            bytes: this._sentBytes,
            seconds: this._sentDuration,
            contentTime: this._contentTime
          };
          this.emit("listen", obj);
          this.rewind.recordListen(obj);
          // reset our stats
          this._sentBytes = 0;
          this._sentDuration = 0;
          return this._contentTime = null;
        }, opts.logInterval || 30 * 1000);
      }
      cb(null, this, ...args);
      finalizeFunc = null;
      return cb = null;
    };
    oFunc = (_offset) => {
      this._offset = _offset;
      debug("Rewinder: creation with ", {
        opts: opts,
        offset: this._offset
      });
      // -- What are we sending? -- #
      if (opts != null ? opts.live_segment : void 0) {
        // we're sending a segment of HTTP Live Streaming data
        this._pumpOnly = true;
        return this.rewind.hls.pumpSegment(this, opts.live_segment, (err, info) => {
          if (err) {
            return cb(err);
          }
          debug("Pumping HLS segment with ", {
            duration: info.duration,
            length: info.length,
            offsetSeconds: info.offsetSeconds
          });
          this._offsetSeconds = info.offsetSeconds;
          return finalizeFunc(info);
        });
      } else if (opts != null ? opts.pumpOnly : void 0) {
        // we're just giving one pump of data, then EOF
        this._pumpOnly = true;
        return this.rewind.pumpFrom(this, this._offset, this.rewind.secsToOffset(this.pumpSecs), false, (err, info) => {
          if (err) {
            return cb(err);
          }
          // return pump information
          return finalizeFunc(info);
        });
      } else if (opts != null ? opts.pump : void 0) {
        if (this._offset === 0) {
          // pump some data before we start regular listening
          debug(`Rewinder: Pumping ${this.rewind.opts.burst} seconds.`);
          this.rewind.pumpSeconds(this, this.pumpSecs, true);
          return finalizeFunc();
        } else {
          // we're offset, so we'll pump from the offset point forward instead of
          // back from live
          return this.rewind.burstFrom(this, this._offset, this.pumpSecs, (err, new_offset) => {
            if (err) {
              return cb(err);
            }
            this._offset = new_offset;
            return finalizeFunc();
          });
        }
      } else {
        return finalizeFunc();
      }
    };
    if (opts.timestamp) {
      this.rewind.findTimestamp(opts.timestamp, (err, offset) => {
        if (err) {
          return cb(err);
        }
        return oFunc(offset);
      });
    } else {
      offset = opts.offsetSecs ? this.rewind.checkOffsetSecs(opts.offsetSecs) : opts.offset ? this.rewind.checkOffset(opts.offset) : 0;
      oFunc(offset);
    }
  }

  //----------
  onFirstMeta(cb) {
    if (this._queue.length > 0) {
      return typeof cb === "function" ? cb(null, this._queue[0].meta) : void 0;
    } else {
      return this.once("readable", () => {
        return typeof cb === "function" ? cb(null, this._queue[0].meta) : void 0;
      });
    }
  }

  _read(size) {
    var _pushQueue, sent;
    boundMethodCheck(this, Rewinder);
    // we only want one queue read going on at a time, so go ahead and
    // abort if we're already reading
    if (this._reading) {
      return false;
    }
    // -- push anything queued up to size -- #

    // set a read lock
    this._reading = true;
    sent = 0;
    // Set up pushQueue as a function so that we can call it multiple
    // times until we get to the size requested (or the end of what we
    // have ready)
    _pushQueue = () => {
      var _handleEmpty, next_buf;
      // -- Handle an empty queue -- #

      // In normal operation, you can think of the queue as infinite,
      // but not speedy.  If we've sent everything we have, we'll send
      // out an empty string to signal that more will be coming.  On
      // the other hand, in pump mode we need to send a null character
      // to signal that we've reached the end and nothing more will
      // follow.
      _handleEmpty = () => {
        if (this._pumpOnly) {
          this.push(null);
        } else {
          this.push('');
        }
        this._reading = false;
        return false;
      };
      // See if the queue is empty to start with
      if (this._queue.length === 0) {
        return _handleEmpty();
      }
      // Grab a chunk off of the queued up buffer
      next_buf = this._queue.shift();
      if (!next_buf) {
        this.rewind.log.error("Shifted queue but got null", {
          length: this._queue.length
        });
      }
      this._queuedBytes -= next_buf.data.length;
      this._sentBytes += next_buf.data.length;
      this._sentDuration += next_buf.duration / 1000;
      debug(`Sent duration is now ${this._sentDuration}`);
      // Not all chunks will contain metadata, but go ahead and send
      // ours out if it does
      if (next_buf.meta) {
        this.emit("meta", next_buf.meta);
      }
      // Push the chunk of data onto our reader. The return from push
      // will tell us whether to keep pushing, or whether we need to
      // stop and wait for a drain event (basically wait for the
      // reader to catch up to us)
      if (this.push(next_buf.data)) {
        sent += next_buf.data.length;
        if (sent < size && this._queue.length > 0) {
          return _pushQueue();
        } else {
          if (this._queue.length === 0) {
            return _handleEmpty();
          } else {
            this.push('');
            return this._reading = false;
          }
        }
      } else {
        // give a signal that we're here for more when they're ready
        this._reading = false;
        return this.emit("readable");
      }
    };
    return _pushQueue();
  }

  _insert(b) {
    boundMethodCheck(this, Rewinder);
    this._queue.push(b);
    this._queuedBytes += b.data.length;
    if (!this._contentTime) {
      // we set contentTime the first time we find it unset, which will be
      // either on our first insert or on our first insert after logging
      // has happened
      this._contentTime = b.ts;
    }
    if (!this._reading) {
      return this._bounceRead();
    }
  }

  //----------

    // Set a new offset (in seconds)
  setOffset(offset) {
    var data;
    // -- make sure our offset is good -- #
    this._offset = this.rewind.checkOffsetSecs(offset);
    // clear out the data we had buffered
    this._queue.slice(0);
    if (this._offset === 0) {
      // pump some data before we start regular listening
      debug(`Rewinder: Pumping ${this.rewind.opts.burst} seconds.`);
      this.rewind.pumpSeconds(this, this.pumpSecs);
    } else {
      // we're offset, so we'll pump from the offset point forward instead of
      // back from live
      [this._offset, data] = this.rewind.burstFrom(this._offset, this.pumpSecs);
      this._queue.push(data);
    }
    return this._offset;
  }

  //----------

    // Return the current offset in chunks
  offset() {
    return this._offset;
  }

  //----------

    // Return the current offset in seconds
  offsetSecs() {
    return this.rewind.offsetToSecs(this._offset);
  }

  //----------
  disconnect() {
    var obj;
    this.rewind._rremoveListener(this);
    // Record either a) our full listening session (pump requests) or
    // b) the portion of the request that we haven't already recorded
    // (non-pump requests)
    obj = {
      id: this.conn_id,
      bytes: this._sentBytes,
      seconds: this._sentDuration,
      offsetSeconds: this._offsetSeconds,
      contentTime: this._contentTime
    };
    this.emit("listen", obj);
    this.rewind.recordListen(obj);
    if (this._segTimer) {
      // clear our listen segment timer
      clearInterval(this._segTimer);
    }
    // This just takes the listener out of lmeta. This will probably go
    // away at some point or be rolled into the function above
    this.rewind.disconnectListener(this.conn_id);
    // make sure we're freed up for GC
    return this.removeAllListeners();
  }

};

//----------

//# sourceMappingURL=rewinder.js.map
