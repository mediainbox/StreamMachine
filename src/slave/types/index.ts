import {SourceVitals} from "../../types";
import {BaseStreamConfig} from "src/types/stream";
import {Bytes, Seconds} from "../../types/util";

export type SlaveStreamConfig = BaseStreamConfig & {
  readonly vitals: SourceVitals;
};

export interface StreamStats {
  connections: number;
  sentBytes: Bytes;
}

export interface StreamStatus {
  key: string;
  bufferStatus: any;
  stats: {
    listeners: number;
    connections: number;
    kbytesSent: number;
  };
}

export type SlaveStatus = {
  readonly _stats: {
    kbytes_sent: number;
    connections: number;
  }
} & {
  [k: string]: StreamStatus;
};

export interface ListenOptions {
  readonly offset: Seconds;
  readonly initialBurst: Seconds;
  readonly pumpAndFinish: boolean;
}
