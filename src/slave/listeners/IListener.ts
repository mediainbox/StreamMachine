import {EventEmitter} from "events";
import {Client} from "./Client";
import {ListenOptions} from "../types";
import {OutputSource} from "../output/OutputSource";

export interface IListener extends EventEmitter {
  readonly id: string;
  readonly streamId: string;
  readonly connectedAt: number;
  readonly client: Client;
  readonly options: ListenOptions;

  getQueuedBytes(): number;
  getSentBytes(): number;
  send(source: OutputSource): void;
  disconnect(): void;
}
