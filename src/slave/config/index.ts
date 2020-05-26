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
  redis: {
    url: '',
  },
}
