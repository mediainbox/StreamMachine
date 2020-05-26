import {Logger} from "winston";
import {EventEmitter} from "events";
import {SlaveStream} from "./stream/Stream";
import express from "express";
import {SourceVitals} from "../types";
import {SlaveConfig} from "./config/types";
import {BaseStreamConfig} from "src/types/stream";
import {Seconds} from "../types/util";

export type SlaveStreamConfig = BaseStreamConfig & {
  readonly vitals: SourceVitals;
};

export interface StreamStats {
  connections: 0;
  sentBytes: 0;
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
