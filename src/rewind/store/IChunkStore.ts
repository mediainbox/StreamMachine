import {Chunk} from "../../types";

export interface IChunkStore {
  setMaxLength(length: number): void;
  length(): number;
  at(index: number): Chunk;
  insert(chunk: Chunk): void;
  info(): void;
}
