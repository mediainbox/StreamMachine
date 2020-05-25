import {SlaveConfig} from "./types";
import {Kbytes, Milliseconds, Seconds} from "../../types/util";

export const DEFAULT_CONFIG: SlaveConfig = {
  slaveId: '',
  log: {
    level: 'info',
    transports: {}
  },
  cluster: {
    enabled: false
  },
  master: {
    password: '',
    urls: [],
    timeout: 5000 as Milliseconds,
  },
  server: {
    useGreenlock: false,
    httpIp: '0.0.0.0',
    httpPort: 80,
    httpsIp: '0.0.0.0',
    httpsPort: 443,
    logRequests: false,
    behindProxy: false,
    blockUserAgents: [],
    cors: {
      enabled: false,
    },
  },
  listener: {
    maxBufferSize: 4096 as Kbytes,
  },
  redis: {
    url: '',
  },
  analytics: {
    enabled: false,
    listenInterval: 30 as Seconds,
  },
  ads: {
    enabled: false,
    serverUrl: '',
    transcoderUrl: '',
    adTimeout: 5000 as Milliseconds,
    impressionDelay: 5000 as Milliseconds,
  }
}
