import {Seconds} from "./util";
import {SourceConfig} from "../master/sources/base/BaseSource";

export interface Err extends Error {
  context?: any;
  code?: string;
}

export interface Chunk {
  readonly ts: number;
  readonly duration: number;
  readonly meta: {
    readonly StreamTitle: string;
    readonly StreamUrl: string;
  };
  readonly data: Buffer;
  readonly frames: number;
  readonly streamKey: string;
}

export interface WsAudioMessage {
  readonly stream: string;
  readonly chunk: Chunk;
}

export type Format = 'mp3' | 'aac';

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
