import {EventEmitter} from "events";
import {Client} from "./Client";
import {ListenOptions} from "../types";
import {ISource} from "../output/ISource";

export interface IListener extends EventEmitter {
  readonly id: string;
  readonly streamId: string;
  readonly connectedAt: number;
  readonly client: Client;
  readonly options: ListenOptions;

  getQueuedBytes(): number;
  getSentBytes(): number;
  getSentSeconds(): number;
  getSource(): ISource;
  send(source: ISource): void;
  disconnect(): void;
}
