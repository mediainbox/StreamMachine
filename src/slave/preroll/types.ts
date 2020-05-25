import { Readable } from "stream";

export interface IAdOperator {
  build(): Promise<Readable>;
  abort(): void;
}
