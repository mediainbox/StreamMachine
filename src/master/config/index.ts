import _ from "lodash";
import * as yup from 'yup';
import {logConfigSchema} from "../../logger/config";
import {DEFAULT_STREAM_CONFIG, MasterStreamConfig, streamConfigSchema} from "./stream";
import {DeepReadonly} from "ts-essentials";
import {BaseAppConfig} from "../../config/types";

export type MasterConfig = BaseAppConfig & DeepReadonly<{
  server: {
    port: number;
  };
  slaveAuth: {
    password: string;
  };
  //sourceIn: IfEnabled<{
  //  port: number;
  //  ip: string;
  //}>;
  //redis: {
  //  url: string;
  //};
  //rewindBuffer: {
  //  dump: IfEnabled<{
  //    dir: string;
  //    frequency: Seconds;
  //  }>;
  //};
  defaultStreamConfig: Partial<MasterStreamConfig>;
  streams: MasterStreamConfig[];
}>;

export const masterConfigSchema = yup.object({
  env: yup.string().required(),
  log: logConfigSchema.required(),
  server: yup.object({
    port: yup.number().positive().max(65535).required()
  }).required(),
  slaveAuth: yup.object({
    password: yup.string().required()
  }).required(),
  streams: yup.array().of(streamConfigSchema).defined(),
}).required();

export const DEFAULT_MASTER_CONFIG: Partial<MasterConfig> = {
  log: {
    level: "info",
    transports: {
      json: {
        enabled: false,
      },
      stackdriver: {
        enabled: false
      }
    }
  },
  server: {
    port: 8020,
  },
  defaultStreamConfig: DEFAULT_STREAM_CONFIG,
  streams: [],
};

export function validateMasterConfig(data: string | object): MasterConfig {
  const final = _.defaultsDeep(
    {},
    typeof data === 'string' ? JSON.parse(data) : data,
    DEFAULT_MASTER_CONFIG
  );
  masterConfigSchema.validateSync(final);

  return final;
}
