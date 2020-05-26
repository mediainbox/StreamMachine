import {Seconds} from "./util";
import {SourceConfig} from "../master/sources/base/ISource";

export interface Err extends Error {
  context?: any;
  code?: string;
}

export interface Chunk {
  readonly ts: number;
  readonly duration: number;
  readonly data: Buffer;
  readonly frames: number;
  readonly streamKey: string;
}

export enum Format {
  AAC = 'aac',
  MP3 = 'mp3'
}

export enum MasterStreamStatus {
  STARTING = 'STARTING',
  CONNECTING = 'CONNECTING',
  CONNECTION_VALIDATE = 'CONNECTION_VALIDATE',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  DESTROYED = 'DESTROYED',
}

export interface StreamMetadata {
  readonly title: string;
  readonly url: string;
}

export interface SourceVitals {
  readonly streamKey: string;
  readonly framesPerSecond: number;
  readonly chunkDuration: Seconds;
}

export interface SourceStatus {
  readonly id: string;
  readonly type: string;
  readonly connected: boolean;
  readonly connectedAt: Date | null;
  readonly config: SourceConfig;
  readonly vitals: SourceVitals | null;
  readonly lastChunkTs: number | null;
}

export interface LoggerConfig {
  readonly level?: string;
  readonly transports: {
    readonly json?: {
      readonly level?: string;
      readonly file: string;
    };
    readonly stackdriver?: {
      readonly level?: string;
    };
  };
}

export type IfEnabled<T> =
  | { enabled: false } & Partial<T>
  | { enabled: true } & T;
