import {componentLogger} from '../logger';
import {Chunk, SourceVitals} from "../types";
import {passthrough, TypedEmitterClass} from "../helpers/events";
import {Seconds} from "../types/util";
import {MemoryStore} from "./store/MemoyStore";
import {Logger} from "winston";
import {toTime} from "../helpers/datetime";
import {RewindWriter} from "./RewindWriter";
import {Readable} from 'stream';

interface Config {
  maxSeconds: Seconds;
}

interface Events {
  reset: () => void;
  preload_start: () => void;
  preload_done: () => void;
}

export interface RewindBufferStatus {
  readonly config: Config;
  readonly vitals: SourceVitals;
  readonly seconds: Seconds;
  readonly chunks: number;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
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

    this.logger = componentLogger(`stream[${this.id}]:rewind_buffer`);

    this.hookEvents();
  }

  hookEvents() {
    passthrough(['shift', 'push', 'unshift'], this.buffer, this);
  }

  push = (chunk: Chunk) => {
    if (this.destroyed) {
      throw new Error('RewindBuffer is destroyed!');
    }

    this.logger.silly(`Insert chunk ${toTime(chunk.ts)}`);
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
    const maxChunks = Math.round(this.config.maxSeconds / this.vitals.chunkDuration);
    this.buffer.setMaxLength(maxChunks);

    this.logger.info(`buffer adjusted, max length is ${this.config.maxSeconds} seconds (${maxChunks} chunks)`);
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
            if (!chunk.__header__) {
              // Insert a chunk into the RewindBuffer. Inserts can only go backward, so
              // the timestamp must be less than @buffer[0].ts for a valid chunk
              this.buffer.insert(chunk);
            }
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
          // TODO: log start/end of buffer
          this.logger.info(`Preload finished, loaded ${this.getBufferedSeconds()} seconds (${this.buffer.length()} chunks)`);
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
    let validatedOffset = this.validateSecondsOffset(offset);
    const validatedLength = _length && this.validateSecondsOffset(_length);

    if (validatedLength && validatedOffset < validatedLength) {
      validatedOffset = validatedLength;
    }

    return this.getChunks(validatedOffset, validatedLength);
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

  chunkAtSeconds(offset: Seconds): Chunk | null {
    return this.buffer.at(this.validateSecondsOffset(offset));
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

  // convert buffered length to seconds
  getBufferedSeconds(): Seconds {
    return Math.round(this.buffer.length() * this.vitals.chunkDuration) as Seconds;
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

    return new RewindWriter(copy, this.vitals);
  }

  getStatus(): RewindBufferStatus {
    return {
      config: this.config,
      vitals: this.vitals,
      seconds: this.getBufferedSeconds(),
      chunks: this.buffer.length(),
      startDate: this.buffer.length() ? new Date(this.buffer.first().ts) : null,
      endDate: this.buffer.length() ? new Date(this.buffer.last().ts) : null,
    }
  }
}
