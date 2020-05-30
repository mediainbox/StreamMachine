import {IfEnabled} from "../types";
import {DeepReadonly} from "ts-essentials";
import * as yup from 'yup';

export type LoggerConfig = DeepReadonly<{
  level: string;
  transports: {
    json: IfEnabled<{
      level?: string;
      file: string;
    }>;
    stackdriver: IfEnabled<{
      level?: string;
      serviceContext?: {
        service: string;
        version: string;
      }
    }>;
  };
}>;

export const logConfigLevelSchema = yup.mixed().oneOf(['silly', 'debug', 'info', 'warn', 'error']);

export const logConfigSchema = yup.object({
  level: logConfigLevelSchema.required(),
  transports: yup.object({
    json: yup.object({
      enabled: yup.boolean().required(),
      level: logConfigLevelSchema,
      file: yup.string().when('enabled', {
        is: true,
        then: yup.string().required()
      })
    }),
    stackdriver: yup.object({
      enabled: yup.boolean().required(),
      serviceContext: yup.object({
        service: yup.string().required(),
        version: yup.string().required(),
      }).default(undefined)
    }),
  }),
});
