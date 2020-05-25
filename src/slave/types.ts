import {Logger} from "winston";
import {EventEmitter} from "events";
import {Stream} from "./stream/Stream";
import express from "express";
import {Format, LoggerConfig} from "../types";
import {SlaveConfig} from "./config/types";

export interface _SourceVitals {
  readonly format: Format;
  readonly codec: string;
  readonly streamKey: string;
  readonly framesPerSecond: number;
  readonly secondsPerChunk: number;
}

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

export interface SlaveCtx {
  readonly config: SlaveConfig;
  readonly logger: Logger;
  readonly events: EventEmitter;
  readonly providers: {}
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
  offset: number;
  pump?: boolean;
}

// Events

export interface ListenerLandedEvent {
  readonly stream: Stream;
  readonly req: express.Request;
  readonly res: express.Response;
}
