import _ from "lodash";
import {Kbytes, Seconds} from "../../types/util";
import {MasterConfig, MasterStreamConfig} from "../types/config";
import {Format, IfEnabled} from "../../types";
import {AdsConfig} from "../../types/stream";

export const DEFAULT_CONFIG: Partial<MasterConfig> = {
  log: {
    level: "info",
    transports: {}
  },
  sourceIn: {
    enabled: false,
  },
  server: {
    port: 8020,
  },
  rewindBuffer: {
    dump: {
      enabled: false,
      frequency: 300 as Seconds,
    }
  }
}

// TODO: add proper validation
export function validateMasterConfig(config: MasterConfig): MasterConfig {
  return _.defaultsDeep({}, config, DEFAULT_CONFIG);
}

// TODO: move to a master config value
export const DEFAULT_STREAM_CONFIG: Partial<MasterStreamConfig> = {
  enabled: true,
  chunkDuration: 5 as Seconds,
  rewindBuffer: {
    maxSeconds: 300 as Seconds,
  },
  listen: {
    initialBurst: 15 as Seconds,
    maxBufferSize: 4096 as Kbytes,
  },
  analytics: {
    enabled: false,
  },
  ads: {
    enabled: false,
  },
  geolock: {
    enabled: false,
  }
}

// TODO: add proper validation
export function validateStreamConfig(config: MasterStreamConfig): MasterStreamConfig {
  return _.defaultsDeep({}, config, DEFAULT_STREAM_CONFIG);
}
