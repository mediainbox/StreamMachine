import {IfEnabled, LoggerConfig} from "../../types";
import {Kbytes, Milliseconds, Seconds} from "../../types/util";
import {DeepReadonly} from "ts-essentials";

export type SlaveConfig = DeepReadonly<{
  slaveId: string;
  log: LoggerConfig;
  cluster: IfEnabled<{
    workers: number;
  }>;
  master: {
    password: string;
    urls: string[];
    timeout: Milliseconds;
  },
  server: {
    useGreenlock: boolean;
    httpIp: string;
    httpPort: number;
    httpsIp: string;
    httpsPort: number;
    logRequests: boolean;
    behindProxy: boolean;
    blockUserAgents: string[];
    cors: IfEnabled<{
      origin: string;
    }>;
  }
  redis: {
    url: string;
  };
  listener: {
    maxBufferSize: Kbytes,
  },
  analytics: IfEnabled<{
    listenInterval: Seconds;
  }>
  ads: IfEnabled<AdsConfig>;
}>;

export type AdsConfig = {
  serverUrl: string;
  transcoderUrl: string;
  adTimeout: Milliseconds;
  impressionDelay: Milliseconds;
  prerollKey?: string;
};
