import {Milliseconds} from "../../types/util";
import _ from "lodash";
import {BaseAppConfig} from "../../config/types";
import {DeepPartial, DeepReadonly} from "ts-essentials";
import {IfEnabled} from "../../types";
import * as yup from "yup";
import {logConfigSchema} from "../../logger/config";

export type SlaveConfig = BaseAppConfig & DeepReadonly<{
  slaveId: string;
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
}>;

export const slaveConfigSchema = yup.object({
  env: yup.string().required(),
  slaveId: yup.string().required(),
  log: logConfigSchema.required(),
  cluster: yup.object({
    enabled: yup.boolean().required(),
    workers: yup.number().when('enabled', {
      is: true,
      then: yup.number().positive().required()
    })
  }).required(),
  master: yup.object({
    urls: yup.array().of(yup.string().url().required()).required(),
    password: yup.string().required(),
    timeout: yup.number().positive().required(),
  }).required(),
  server: yup.object({
    useGreenlock: yup.boolean().required(),
    httpIp: yup.string().required(),
    httpPort: yup.number().positive().required(),
    httpsIp: yup.string().required(),
    httpsPort: yup.number().positive().required(),
    logRequests: yup.boolean().required(),
    behindProxy: yup.boolean().required(),
    blockUserAgents: yup.array().of(yup.string().url().required()).defined(),
    cors: yup.object({
      enabled: yup.boolean().required(),
      origin: yup.string().when('enabled', {
        is: true,
        then: yup.string().url().required()
      })
    }).required()
  }).required(),
}).required();

export const DEFAULT_SLAVE_CONFIG: DeepPartial<SlaveConfig> = {
  log: {
    level: 'info',
    transports: {
      json: {
        enabled: false,
      },
      stackdriver: {
        enabled: false,
      }
    }
  },
  cluster: {
    enabled: false
  },
  master: {
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
}

export function validateSlaveConfig(data: string | object): SlaveConfig {
  const final = _.defaultsDeep(
    {},
    typeof data === 'string' ? JSON.parse(data) : data,
    DEFAULT_SLAVE_CONFIG
  );
  slaveConfigSchema.validateSync(final);

  return final;
}
