import {BaseStreamConfig} from "../../types/stream";
import {Seconds} from "../../types/util";
import {DeepReadonly} from "ts-essentials";
import {IfEnabled, LoggerConfig} from "../../types";
import {SourceType} from "./index";
import {Type} from "../../helpers/types";

type StaticConfig = DeepReadonly<{
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
}>;

type DynamicConfig = DeepReadonly<{
  streams: MasterStreamConfig[];
}>;

export type MasterConfig = StaticConfig & DynamicConfig;

export type MasterStreamConfig = BaseStreamConfig & {
  readonly enabled: boolean;
  readonly chunkDuration: Seconds;
  readonly sources: readonly SourceConfig[];
};

export type BaseSourceConfig = {
  readonly enabled: boolean;
  readonly id: string;
  readonly name?: string;
  readonly priority: number;
};

export type SourceConfig =
  | IcecastUrlConfig
  | IcecastInConfig;

export type IcecastUrlConfig = BaseSourceConfig & Type<SourceType.ICECAST_URL, { url: string; }>;
export type IcecastInConfig = BaseSourceConfig & Type<SourceType.ICECAST_URL, { url: string; }>;

export type ConfigProviderConfig =
  | Type<'file', { filepath: string }>
  | Type<'url', { url: string, pingInterval?: Seconds }>
  | Type<'redis', {}>;
