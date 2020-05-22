import {PassThrough, Readable} from "stream";

const MultiStream = require('multistream');

/**
 * Combines preroller + stream audio as a single stream
 */
export class OutputSource extends PassThrough {
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

  _destroy(error: Error | null, callback: (error: (Error | null)) => void) {
    super._destroy(error, callback);
    this.combined.unpipe();
    this.combined.destroy();
  }

  getQueuedBytes() {
    return this.rewinder.queuedBytes;
  }
}
