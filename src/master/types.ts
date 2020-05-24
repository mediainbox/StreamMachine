import {Logger} from "winston";
import {EventEmitter} from "events";
import {DeepReadonly} from "../helpers/types";
import {Milliseconds, Seconds} from "../types/util";
import {Format} from "../types";

export interface MasterCtx {
  readonly config: MasterConfig_V1;
  readonly logger: Logger;
  readonly events: EventEmitter;
  readonly providers: {}
}

export type StreamConfig = {
  clientId: string;
  id: string;
  format: Format;
  metadata: {
    title: string;
    url: string;
  }
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
};

type SourceConfig = {
  priority: number;
} & (
  | {
  type: 'url';
  url: string;
} | {
  type: 'source_in';
  host: string;
  password: string;
}
);

export type MasterConfig = DeepReadonly<{
  rewind: {
    dump?: {
      dir: string;
      frequency: Seconds;
    };
  };
  log: {
    logRequests: boolean;
    transports: {
      json: false,
      stackdriver: true
    };
  };
  sourceIn?: {
    port?: number;
    ip?: string;
  };
  slaveServer: {
    port?: number;
    password: string;
  };
  redis: {
    url: string;
  };
  analytics: {
    listenInterval: Seconds;
  }
  ads: {
    adUrl?: string;
    transcoderUrl?: string;
    impressionDelay: number;
  }
  streams?: StreamConfig[];
}>;
