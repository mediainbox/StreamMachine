import {BaseStreamConfig} from "../../types/stream";
import {SourceVitals} from "../../types";

export type SlaveStreamsConfig = readonly SlaveStreamConfig[];

export type SlaveStreamConfig = BaseStreamConfig & {
  readonly vitals: SourceVitals;
};
