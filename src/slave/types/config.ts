import {DeepReadonly} from "ts-essentials";
import {IfEnabled, LoggerConfig} from "../../types";
import {Milliseconds} from "../../types/util";

export type SlaveConfig = DeepReadonly<{
  slaveId: string;
  log: LoggerConfig;
  cluster: IfEnabled<{
    workers: number;
  }>;
  master: {
    urls: string[];
    password: string;
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
}>;
