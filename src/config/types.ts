import {LoggerConfig} from "../logger/config";
import {Type} from "../helpers/types";
import {Minutes, Seconds} from "../types/util";

export interface BaseAppConfig {
  readonly env: string;
  readonly log: LoggerConfig;
}

export type ConfigProviderConfig =
  | Type<'file', { filepath: string }>
  | Type<'url', { url: string, refreshInterval?: Minutes }>;
