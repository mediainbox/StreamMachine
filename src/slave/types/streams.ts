import {StreamConfig} from "../../types/stream";
import {SourceVitals} from "../../types";

export type SlaveStreamsConfig = readonly SlaveStreamConfig[];

export type SlaveStreamConfig = StreamConfig & {
  readonly vitals: SourceVitals;
};
