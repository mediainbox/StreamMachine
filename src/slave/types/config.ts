import {SlaveConfig} from "../config/types";
import {DEFAULT_CONFIG} from "../config";
import _ from "lodash";

export function validateConfig(config: SlaveConfig): SlaveConfig {
  return _.defaultsDeep({}, config, DEFAULT_CONFIG);
}
