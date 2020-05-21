import {PrerollerConfig} from "./preroll/types";
import { Logger } from "winston";
import { EventEmitter } from "events";

export type Format = 'mp3' | 'aac';

export interface Client {
  readonly sessionId: string;
  readonly ip: string;
  readonly ua: string;
}

export interface IListener {
  getId(): string;
  getClient(): Client;
  disconnect(): void;
}

export interface StreamMetadata {
  readonly title: string;
  readonly url: string;
}

export interface StreamConfig {
  readonly maxBufferSize: number;
  readonly maxSeconds: number;
  readonly initialBurst: number;
  readonly preroll: PrerollerConfig;
}

export interface StreamVitals {
  readonly format: Format;
  readonly codec: string;
  readonly streamKey: string;
  readonly framesPerSecond: number;
  readonly secondsPerChunk: number;
}

export interface StreamStats {
  connections: 0;
  kbytesSent: 0;
}

export interface ListenEvent {
  readonly streamKey: string;
  readonly kbytesSent: number;
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
  readonly config: SlaveConfig_V1;
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

export interface SlaveConfig_V1 {
  readonly mode: "slave";
  readonly cluster: number;
  readonly log: {
    readonly stackdriver: boolean;
  };
  readonly hls: {
    readonly segment_duration: number;
    readonly limit_full_index: boolean;
  };
  readonly debug_incoming_requests: boolean;
  readonly http_port: number;
  readonly https_port: number;
  readonly ua_skip: boolean;
  readonly behind_proxy: boolean;
  readonly cors: {
    enabled: boolean;
  }
}

export interface SourceConfig {
  readonly monitored: boolean;
  readonly password: boolean;
  readonly source_password: string;
  readonly format: Format;
}

export interface InputConfig {
  readonly streams: {
    readonly [k: string]: StreamConfig;
  };
  readonly sources: {
    readonly [k: string]: SourceConfig;
  }
}
