import { Readable } from "stream";

export interface IOutput {
  readonly TYPE: string;
  send(stream: Readable): void;
}
