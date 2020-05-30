import {Readable} from "stream";
import {EventEmitter} from "events";
import {Bytes, Seconds} from "../../types/util";

// TODO: convert to writable?
export interface IOutput extends EventEmitter {
  getType(): string;
  getQueuedBytes(): Bytes;
  getSentBytes(): Bytes;
  getSentSeconds(): Seconds;
  shouldPump(): boolean;
  send(stream: Readable): void;
  disconnect(): void;
}
