import _ from "lodash";
import {AnalyticsConfig} from "../types/config";

export const DEFAULT_CONFIG: AnalyticsConfig = {
  env: '',
  log: {
    level: 'info',
    transports: {}
  },
  elastic: {
    nodes: ['http://localhost:9200'],
  },
  redis: {
    host: 'localhost',
    port: 6379
  }
}

export function validateAnalyticsConfig(config: AnalyticsConfig): AnalyticsConfig {
  return _.defaultsDeep({}, config, DEFAULT_CONFIG);
}
