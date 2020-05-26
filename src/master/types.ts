import {Seconds} from "../types/util";
import {IfEnabled, LoggerConfig} from "../types";
import {DeepReadonly} from "ts-essentials";
import {BaseStreamConfig} from "../types/stream";

export type MasterConfig = DeepReadonly<{
  log: LoggerConfig;
  sourceIn: IfEnabled<{
    port: number;
    ip: string;
  }>;
  server: {
    port: number;
  };
  slavesServer: {
    password: string;
  };
  redis: {
    url: string;
  };
  rewindBuffer: {
    dump: IfEnabled<{
      dir: string;
      frequency: Seconds;
    }>;
  };
  streams?: MasterStreamConfig[];
}>;

export type MasterStreamConfig = BaseStreamConfig & {
  readonly chunkDuration: Seconds;
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
