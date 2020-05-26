import {componentLogger} from '../logger';
import {Chunk, SourceVitals} from "../types";
import {passthrough, TypedEmitterClass} from "../helpers/events";
import {Seconds} from "../types/util";
import {MemoryStore} from "./store/MemoyStore";
import {Logger} from "winston";
import {toTime} from "../helpers/datetime";
import {RewindWriter} from "./RewindWriter";
import {Readable} from 'stream';
import _ from "lodash";

interface Config {
  bufferSeconds: Seconds;
}

interface Events {
  reset: () => void;
  preload_start: () => void;
  preload_done: () => void;
}

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
export class RewindBuffer extends TypedEmitterClass<Events>() {
  static EVENTS = {
    RESET: 'reset',
    PRELOAD_START: 'PRELOAD_START',
    PRELOAD_DONE: 'PRELOAD_DONE',
  }

  private buffer = new MemoryStore();
  private preloading = false;
  private destroyed = false;

  private readonly logger: Logger;

  constructor(
    private id: string,
    private config: Config,
    private vitals: SourceVitals,
  ) {
    super();

    this.logger = componentLogger(`rewind_buffer[${this.id}]`);

    this.hookEvents();
  }

  hookEvents() {
    passthrough(['shift', 'push', 'unshift'], this.buffer, this);
  }

  push = (chunk: Chunk) => {
    if (this.destroyed) {
      throw new Error('RewindBuffer is destroyed!');
    }

    this.logger.silly(`insert chunk ${toTime(chunk.ts)} in buffer`);
    this.buffer.insert(chunk);
  };

  updateVitals(vitals: SourceVitals) {
    if (this.vitals.streamKey !== vitals.streamKey) {
      // if it's a reconnection, but didn't match rate
      // it should wipe out the old buffer
      this.logger.warn("incompatile vitals received, reset buffer", {
        oldVitals: this.vitals,
        newVitals: vitals,
      });

      this.vitals = vitals;
      this.buffer.reset();
      this.adjustBufferSize();
      return;
    }

    this.logger.info("compatible vitals received");
  }

  adjustBufferSize() {
    const maxChunks = Math.round(this.config.bufferSeconds / this.vitals.chunkDuration);
    this.buffer.setMaxLength(maxChunks);

    this.logger.info(`buffer adjusted, max length is ${this.config.bufferSeconds} seconds (${maxChunks} chunks)`);
  }

  // Load a RewindBuffer.  Buffer should arrive newest first, which means
  // that we can simply shift() it into place and don't have to lock out
  // any incoming data.
  preload(loader: Readable): Promise<void> {
    this.preloading = true;
    this.emit("preload_start");

    return new Promise((resolve) => {
      loader
        .on('readable', () => {
          let chunk;

          while (chunk = loader.read()) {
            // Insert a chunk into the RewindBuffer. Inserts can only go backward, so
            // the timestamp must be less than @buffer[0].ts for a valid chunk
            this.buffer.insert(chunk);
          }
        })
        .on('error', (error: Error) => {
          this.preloading = false;
          this.logger.error('error ocurred while preloading', {error})
          this.emit("preload_done");
          resolve();
        })
        .on('end', () => {
          this.preloading = false;
          this.logger.info(`preload finished, loaded ${this.getBufferedSeconds()} seconds (${this.buffer.length()} chunks)`);
          this.emit("preload_done");
          resolve();
        });
    });
  }

  validateSecondsOffset(seconds: Seconds) {
    return this.validateOffset(this.secondsToOffset(seconds));
  }

  validateOffset(offset: number): number {
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

  getSeconds(offset: Seconds, _length?: Seconds): Chunk[] {
    return this.getChunks(
      this.validateSecondsOffset(offset),
      _length && this.validateSecondsOffset(_length),
    );
  }

  getChunks(offset: number, _length?: number): Chunk[] {
    // if not defined, equals offset, otherwise length max is = offset
    const length = typeof _length === 'undefined' ? offset :
      (_length > offset ? offset : _length);

    // offset = 0 is live, length = 0 is no chunks
    if (offset === 0 || length === 0) {
      return [];
    }

    return this.buffer.range(offset, length);
  }

  destroy() {
    this.removeAllListeners();
    this.buffer.removeAllListeners();
  }

  isPreloading() {
    return this.preloading;
  }

  reset() {
    this.buffer.reset();
    this.emit("reset");
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
    return Math.round(this.buffer.length() * this.vitals.chunkDuration);
  }

  secondsToOffset(seconds: Seconds) {
    return Math.round(Number(seconds) / this.vitals.chunkDuration);
  }

  offsetToSeconds(offset: number) {
    return Math.round(Number(offset) * this.vitals.chunkDuration);
  }

  // TODO: move away
  // Dump the rewindbuffer. We want to dump the newest data first, so that
  // means running back from the end of the array to the front.
  dump(): RewindWriter {
    // taking a copy of the array should effectively freeze us in place
    const copy = this.buffer.clone();

    return new RewindWriter(copy, this.vitals.chunkDuration, this.vitals.streamKey);
  }
}
