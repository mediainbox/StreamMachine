import {Milliseconds} from "../../types/util";
import _ from "lodash";
import {SlaveConfig} from "../types/config";

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

export function validateConfig(config: SlaveConfig): SlaveConfig {
  return _.defaultsDeep({}, config, DEFAULT_CONFIG);
}
