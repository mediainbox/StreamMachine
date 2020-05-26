import {Readable} from "stream";
import {Chunk} from "../types";
import {RewindBuffer} from "./RewindBuffer";
import {ListenOptions} from "../slave/types";

const HIGH_WATERMARK = 256 * 1024 // 256 KB;

interface Config extends ListenOptions {
}

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

  private readonly queue: Chunk[] = [];

  // keep track of the duration of the segments we have pushed
  // Note that for non-pump requests, these will be reset periodically
  // as we report listening segments
  private queuedBytes = 0;
  private reading = false;

  constructor(
    private readonly rewind: RewindBuffer,
    private readonly config: Config,
  ) {
    super({
      highWaterMark: HIGH_WATERMARK
    });
  }

  async pump(): Promise<void> {
    // offset != 0: pump some data before we start regular listening
    // offset = 0: pump back from live
    const chunks = this.rewind.getSeconds(this.config.offset, this.config.initialBurst);

    this.enqueueChunks(chunks);
  }

  // -- Handle an empty queue -- #
  // In normal operation, you can think of the queue as infinite,
  // but not speedy.  If we've sent everything we have, we'll send
  // out an empty string to signal that more will be coming.  On
  // the other hand, in pump mode we need to send a null character
  // to signal that we've reached the end and nothing more will
  // follow.
  handleEmpty() {
    if (this.config.pumpAndFinish) {
      this.push(null);
    } else {
      this.push('');
    }

    this.reading = false;
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
      // See if the queue is empty to start with
      if (this.queue.length === 0) {
        this.handleEmpty();
        return;
      }

      // grab a chunk off of the queued up buffer
      const nextChunk: Chunk | undefined = this.queue.shift();

      if (!nextChunk) {
        this.emit('error', "Shifted queue but got null");
        return;
      }

      this.queuedBytes -= nextChunk.data.length;

      this.stats.bytesSent += nextChunk.data.length;
      this.stats.secondsSent += nextChunk.duration / 1000;

      // Not all chunks will contain metadata, but go ahead and send
      // ours out if it does
      //if (nextChunk.meta) {
        //this.emit("meta", nextChunk.meta);
      //}

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
          this.handleEmpty();
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

  enqueueChunks(chunks: Chunk[]) {
    chunks.forEach(c => this.enqueueChunk(c));
  }

  enqueueChunk(chunk: Chunk) {
    this.queue.push(chunk);
    this.queuedBytes += chunk.data.length;

    if (!this.reading) {
      this.read(0);
    }
  }

  getStats() {
    return this.stats;
  }

  _destroy() {
    this.emit('destroy');
    this.removeAllListeners();
  }
}
