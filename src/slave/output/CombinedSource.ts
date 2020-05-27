import {PassThrough, Readable} from "stream";
import {Chunk} from "../../types";
import {ISource} from "./ISource";
import {Rewinder} from "../../rewind/Rewinder";

const MultiStream = require('multistream');

/**
 * Combines preroller + stream audio as a single stream
 */
export class CombinedSource extends PassThrough implements ISource {
  private combined: Readable;

  constructor(
    private readonly preroll: Readable,
    private readonly rewinder: Rewinder,
  ) {
    super();

    this.combined = new MultiStream([
      preroll,
      rewinder,
    ]) as Readable;

    this.combined.pipe(this);
  }

  pullChunk() {
    this.rewinder.pullChunk();
  }

  _destroy(error: Error | null, callback: (error: (Error | null)) => void) {
    super._destroy(error, callback);
    this.combined.unpipe();
    this.combined.destroy();
  }

  getQueuedBytes() {
    return 0;
    //return this.rewinder.queuedBytes; // FIXME
  }

  getSentSeconds() {
    return this.rewinder.getStats().secondsSent;
  }
}
