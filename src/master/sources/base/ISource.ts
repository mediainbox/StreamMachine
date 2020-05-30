import {Chunk, SourceStatus, SourceVitals, StreamMetadata} from "../../../types";
import {TypedEmitter} from "../../../helpers/events";
import {BaseSourceConfig} from "../../config/source";

export interface SourceEvents {
  connect: () => void;
  connect_error: (error: Error) => void;
  disconnect: () => void;
  chunk: (chunk: Chunk) => void;
  vitals: (vitals: SourceVitals) => void;
  metadata: (meta: StreamMetadata) => void;
  destroy: () => void;
}

export interface ISource<Config extends BaseSourceConfig = any> extends TypedEmitter<SourceEvents> {
  getId(): string;

  getLabel(): string;

  getPriority(): number;

  getStatus(): SourceStatus<Config>;

  isConnected(): boolean;

  getConfig(): Config;

  configure(config: Config): void;

  connect(): void;

  disconnect(): void;

  destroy(): void;
}
