import {EventEmitter} from "events";
import {ISource} from "../output/ISource";
import {Bytes, Seconds} from "../../types/util";
import {ClientData} from "../../types";
import {ListenOptions} from "../types";

export interface IListener extends EventEmitter {
  getId(): string;
  getSessionId(): string;
  getClient(): ClientData;
  getOptions(): ListenOptions;
  getQueuedBytes(): Bytes;
  getSentBytes(): Bytes;
  getSentSeconds(): Seconds;
  getSource(): ISource;
  send(source: ISource): void;
  disconnect(): void;
}
