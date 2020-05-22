import {Readable} from "stream";
import {Logger} from "winston";
import {Chunk} from "../../types";

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
export class Rewinder extends Readable {
  private stats = {
    bytesSent: 0,
    secondsSent: 0,
    contentTime: 0,
  };

  // keep track of the duration of the segments we have pushed
  // Note that for non-pump requests, these will be reset periodically
  // as we report listening segments
  private offsetSeconds = null;
  private pumpOnly = false;
  private offset = 0;
  private readonly queue: Chunk[] = [];
  private queuedBytes = 0;
  private reading = false;
  private pumpSecs: number;

  constructor(
    private readonly rewind: any,
    private readonly opts: {
      offset?: number;
      pump?: boolean;
      pumpOnly?: boolean;
    } = {},
    private readonly logger: Logger,
  ) {
    super({
      highWaterMark: 256 * 1024 // 256 KB
    });

    // Implement the guts of the Readable stream. For a normal stream,
    // RewindBuffer will be calling _insert at regular ticks to put content
    // into our queue, and _read takes the task of buffering and sending
    // that out to the listener.

    this.pumpSecs = opts.pump === true ? this.rewind.initialBurst : opts.pump;
  }

  start() {
    return new Promise((resolve, reject) => {
      const oFunc = (offset: number) => {
        this.offset = offset;
        /*debug("Rewinder: creation with ", {
          opts: opts,
          offset: this.offset
        });*/
        // -- What are we sending? -- #
        if (this.opts != null ?this.opts.pumpOnly : void 0) {
          // we're just giving one pump of data, then EOF
          this.pumpOnly = true;
          return this.rewind.pumpFrom(this, this.offset, this.rewind.secsToOffset(this.pumpSecs), false, (err: Error, info: any) => {
            if (err) {
              return reject(err);
            }
            // return pump information
            return resolve(info);
          });
        } else if (this.opts != null ? this.opts.pump : void 0) {
          if (this.offset === 0) {
            // pump some data before we start regular listening
            //debug(`Rewinder: Pumping ${this.rewind.burst} seconds.`);
            this.rewind.pumpSeconds(this, this.pumpSecs, true);
            return resolve();
          } else {
            // we're offset, so we'll pump from the offset point forward instead of
            // back from live
            return this.rewind.burstFrom(this, this.offset, this.pumpSecs, (err: Error, newoffset: number) => {
              if (err) {
                return reject(err);
              }
              this.offset = newoffset;
              return resolve();
            });
          }
        } else {
          return resolve();
        }
      };

      //offset = opts.offsetSecs ? this.rewind.validateSecondsOffset(opts.offsetSecs) : opts.offset ? this.rewind.validateOffset(opts.offset) : 0;
      const offset = this.opts.offset ? this.rewind.validateSecondsOffset(this.opts.offset) : 0;
      oFunc(offset);
    });
  }

  _read = (size: number): void => {
    // we only want one queue read going on at a time, so go ahead and
    // abort if we're already reading
    if (this.reading) {
      return;
    }
    // -- push anything queued up to size -- #

    // set a read lock
    this.reading = true;
    let readBytesSent = 0;

    // Set up pushQueue as a function so that we can call it multiple
    // times until we get to the size requested (or the end of what we
    // have ready)
    const pushQueue = () => {
      // -- Handle an empty queue -- #
      // In normal operation, you can think of the queue as infinite,
      // but not speedy.  If we've sent everything we have, we'll send
      // out an empty string to signal that more will be coming.  On
      // the other hand, in pump mode we need to send a null character
      // to signal that we've reached the end and nothing more will
      // follow.
      const handleEmpty = () => {
        if (this.pumpOnly) {
          this.push(null);
        } else {
          this.push('');
        }
        this.reading = false;
      };

      // See if the queue is empty to start with
      if (this.queue.length === 0) {
        handleEmpty();
        return;
      }

      // grab a chunk off of the queued up buffer
      const nextChunk: Chunk | undefined = this.queue.shift();
      if (!nextChunk) {
        this.logger.error("Shifted queue but got null", {
          length: this.queue.length
        });
        return;
      }

      this.queuedBytes -= nextChunk.data.length;

      this.stats.bytesSent += nextChunk.data.length;
      this.stats.secondsSent += nextChunk.duration / 1000;

      // Not all chunks will contain metadata, but go ahead and send
      // ours out if it does
      if (nextChunk.meta) {
        this.emit("meta", nextChunk.meta);
      }

      // Push the chunk of data onto our reader. The return from push
      // will tell us whether to keep pushing, or whether we need to
      // stop and wait for a drain event (basically wait for the
      // reader to catch up to us)
      if (this.push(nextChunk.data)) {
        readBytesSent += nextChunk.data.length;

        // if sent bytes are less than requested and there are
        // still chunks in the queue, run the fn again
        if (readBytesSent < size && this.queue.length > 0) {
          pushQueue();
          return;
        }

        // no more chunks
        if (this.queue.length === 0) {
          handleEmpty();
          return;
        }

        // requested size satisfied, wait for read request
        this.push('');
        this.reading = false;
      } else {
        // give a signal that we're here for more when they're ready
        this.reading = false;
        this.emit("readable");
      }
    };

    pushQueue();
  };

  _insert = (chunk: Chunk) => {
    this.queue.push(chunk);
    this.queuedBytes += chunk.data.length;

    if (!this.stats.contentTime) {
      // we set contentTime the first time we find it unset, which will be
      // either on our first insert or on our first insert after logging
      // has happened
      this.stats.contentTime = chunk.ts;
    }

    if (!this.reading) {
      this.read(0);
    }
  };

  _destroy() {
    this.rewind.removeRewinder(this);
    this.removeAllListeners();
    this.logger.debug('rewinder destroyed');
  }

  // returns the current offset in chunks
  getOffset() {
    return this.offset;
  }

  getStats() {
    return this.stats;
  }

  resetStats() {
    this.stats = {
      bytesSent: 0,
      secondsSent: 0,
      contentTime: 0,
    };
  }
}
