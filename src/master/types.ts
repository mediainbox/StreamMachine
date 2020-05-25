import {Logger} from "winston";
import {EventEmitter} from "events";
import {Seconds} from "../types/util";
import {Chunk, Format, LoggerConfig} from "../types";
import {Stream} from "./streams/Stream";
import {Request} from "express";
import {DeepReadonly} from "ts-essentials";

export type StreamConfig = DeepReadonly<{
  clientId: string;
  id: string;
  meta: {
    title: string;
    url: string;
  }
  format: Format;
  rewind: {
    bufferSeconds: Seconds;
    initialBurst: Seconds;
  };
  sources: readonly SourceConfig[];
  ads?: {
    adUrl?: string;
    transcoderUrl?: string;
    prerollKey?: string;
  }
  geolock?: {
    enabled: false;
    mode: 'whitelist';
    countryCodes: readonly string[]
    fallback?: string;
  };
}>;

export enum SourceType {
  ICECAST_URL = 'icecast_url',
  ICECAST_IN = 'icecast_in',
}

export type SourceConfig = {
  priority: number;
} & (
  | {
  type: SourceType.ICECAST_URL;
  url: string;
} | {
  type: SourceType.ICECAST_IN;
  host: string;
  password: string;
}
);

export type MasterConfig = DeepReadonly<{
  rewind: {
    dump?: {
      enabled?: boolean;
      dir: string;
      frequency: Seconds;
    };
  };
  log: LoggerConfig;
  sourceIn?: {
    port?: number;
    ip?: string;
  };
  server: {
    port?: number;
  }
  slavesServer: {
    password: string;
  };
  redis: {
    url: string;
  };
  streams: StreamConfig[];

  //chunk_duration!
}>;


export interface StreamChunk {
  readonly streamId: string;
  readonly chunk: Chunk;
}

export type StreamRequest = Request & { stream?: Stream };
