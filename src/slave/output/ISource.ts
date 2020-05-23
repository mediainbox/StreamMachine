import {Readable} from "stream";
import {Chunk} from "../../types";

export interface ISource extends Readable {
  addChunk(chunk: Chunk): void;
  getQueuedBytes(): number;
  getSentSeconds(): number;
}
