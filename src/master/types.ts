import {Seconds} from "../types/util";
import {Chunk, Format, LoggerConfig} from "../types";
import {Stream} from "./stream/Stream";
import {Request} from "express";
import {DeepReadonly} from "ts-essentials";
import {BaseStreamConfig} from "../types/stream";

export type MasterStreamConfig = BaseStreamConfig & {
  readonly sources: readonly SourceConfig[];
};

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
  streams: MasterStreamConfig[];
  //chunk_duration!
}>;


export interface StreamChunk {
  readonly streamId: string;
  readonly chunk: Chunk;
}

export type StreamRequest = Request & { stream?: Stream };
