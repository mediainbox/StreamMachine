import {Readable} from "stream";

export interface ISource extends Readable {
  pullChunk(): void;

  getQueuedBytes(): number;

  getSentSeconds(): number;
}
