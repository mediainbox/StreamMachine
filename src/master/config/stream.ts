import * as yup from "yup";
import {SourceType} from "../types";
import _ from "lodash";
import {Kbytes, Seconds} from "../../types/util";
import {BaseStreamConfig} from "../../types/stream";
import {SourceConfig} from "./source";

export type MasterStreamConfig = BaseStreamConfig & {
  readonly enabled: boolean;
  readonly chunkDuration: Seconds;
  readonly sources: readonly SourceConfig[];
};

export function validateStreamConfig(config: Partial<MasterStreamConfig>): MasterStreamConfig {
  const final = _.defaultsDeep({}, config, DEFAULT_STREAM_CONFIG);
  streamConfigSchema.validateSync(final);

  return final;
}

export const DEFAULT_STREAM_CONFIG: Partial<MasterStreamConfig> = {
  enabled: true,
  chunkDuration: 5 as Seconds,
  rewindBuffer: {
    maxSeconds: 300 as Seconds,
  },
  listen: {
    initialBurstSeconds: 15 as Seconds,
    maxBufferSize: 4096 as Kbytes,
  },
  eventsReport: {
    listener: {
      enabled: true,
      interval: 15 as Seconds,
    }
  },
  ads: {
    enabled: false,
  },
}

export const streamConfigSchema = yup.object({
  enabled: yup.boolean().required(),
  clientId: yup.string().required(),
  id: yup.string().required(),
  metadata: yup.object({
    title: yup.string(),
    url: yup.string(),
  }),
  format: yup.mixed().oneOf(['mp3', 'aac']),
  chunkDuration: yup.number().positive(),
  rewindBuffer: yup.object({
    maxSeconds: yup.number().positive().max(600),
  }),
  listen: yup.object({
    initialBurst: yup.number().positive(),
    maxBufferSize: yup.number().positive(),
  }),
  eventsReport: yup.object({
    listener: yup.object({
      interval: yup.number().positive(),
    })
  }),
  ads: yup.object({
    enabled: yup.boolean().required(),
    serverUrl: yup.string().when('enabled', {
      is: true,
      then: yup.string().url().required()
    }),
    transcoderUrl: yup.string().when('enabled', {
      is: true,
      then: yup.string().url().required()
    }),
    adTimeout: yup.number().positive(),
    impressionDelay: yup.number().positive(),
    prerollKey: yup.string(),
  }),
  sources: yup.array().of(yup.object({
    enabled: yup.boolean().required(),
    id: yup.string().required(),
    name: yup.string(),
    priority: yup.number().positive().max(100).required(),
    type: yup.mixed().oneOf([SourceType.ICECAST_URL]),
    url: yup.string().when('type', {
      is: SourceType.ICECAST_URL,
      then: yup.string().url()
    })
  }))
});
