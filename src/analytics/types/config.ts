import {ClientOptions} from "@elastic/elasticsearch";
import {BaseAppConfig} from "../../config/types";

export interface AnalyticsConfig extends BaseAppConfig {
  readonly elastic: {
    nodes?: ClientOptions['nodes'];
  }
  readonly redis: {
    host?: string;
    port?: number;
  }
}
