import { Readable } from "stream";
import { EventEmitter } from "events";

// TODO: convert to writable?
export interface IOutput extends EventEmitter {
  getQueuedBytes(): number;
  shouldPump(): boolean;
  send(stream: Readable): void;
  disconnect(): void;
}
