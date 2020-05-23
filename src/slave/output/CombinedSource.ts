import {PassThrough, Readable} from "stream";
import {Chunk} from "../../types";
import {ISource} from "./ISource";

const MultiStream = require('multistream');

/**
 * Combines preroller + stream audio as a single stream
 */
export class CombinedSource extends PassThrough implements ISource {
  private combined: Readable;

  constructor(
    private readonly preroll: Readable,
    private readonly rewinder: any,
  ) {
    super();

    this.combined = new MultiStream([
      preroll,
      rewinder,
    ]) as Readable;

    this.combined.pipe(this);
  }

  addChunk(chunk: Chunk) {
    this.rewinder._insert(chunk);
  }

  _destroy(error: Error | null, callback: (error: (Error | null)) => void) {
    super._destroy(error, callback);
    this.combined.unpipe();
    this.combined.destroy();
  }

  getQueuedBytes() {
    return this.rewinder.queuedBytes;
  }

  getSentSeconds() {
    return this.rewinder.getStats().secondsSent;
  }
}
