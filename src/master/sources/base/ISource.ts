import {Chunk, Format, SourceStatus, SourceVitals, StreamMetadata} from "../../../types";
import {Seconds} from "../../../types/util";
import {TypedEmitter} from "../../../helpers/events";

export interface SourceConfig {
  readonly type: string;
  readonly format: Format;
  readonly chunkDuration: Seconds;
  readonly priority: number;
}

export interface SourceEvents {
  connect: () => void;
  disconnect: () => void;
  chunk: (chunk: Chunk) => void;
  vitals: (vitals: SourceVitals) => void;
  metadata: (meta: StreamMetadata) => void;
}

export interface ISource extends TypedEmitter<SourceEvents> {
  getType(): string;
  getVitals(): Promise<SourceVitals>;
  getStatus(): SourceStatus;
  connect(): void;
  disconnect(): void;
}
