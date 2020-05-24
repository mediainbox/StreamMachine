import {Logger} from "winston";
import {EventEmitter} from "events";
import {Stream} from "./stream/Stream";
import express from "express";
import {IListener} from "./listeners/IListener";
import {Format} from "../types";

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
  readonly slave: {
    readonly master: string[];
    readonly timeout?: number;
  }
  readonly cluster: number;
  readonly log: {
    readonly json?: {
      readonly level?: string;
      readonly file: string;
    };
    readonly stackdriver?: {
      readonly level?: string;
    };
  };
  readonly hls: {
    readonly segment_duration: number;
    readonly limit_full_index: boolean;
  };
  readonly debug_incoming_requests: boolean;
  readonly http_ip: string | null;
  readonly http_port: number | null;
  readonly https_ip: string | null;
  readonly https_port: number | null;
  readonly ua_skip?: string[];
  readonly behind_proxy: boolean;
  readonly cors: {
    enabled: boolean;
    origin?: string;
  }
}

export interface InputConfig {
  readonly streams: {
    readonly [k: string]: StreamConfig_V1;
  };
  readonly sources: {
    readonly [k: string]: SourceConfig_V1;
  }
}

export interface StreamConfig_V1 {
  readonly key: string;
  readonly burst: number;
  readonly seconds: number;
  readonly max_buffer: number;
  readonly preroll_key?: string;
  readonly preroll: string;
  readonly transcoder?: string;
  readonly impression_delay?: number;
  readonly metaTitle: string;
  readonly metaUrl: string;
  readonly format: Format;
  readonly codec: string;
  readonly log_interval: number;
}

export interface SourceConfig_V1 {
  readonly monitored: boolean;
  readonly password: boolean;
  readonly source_password: string;
  readonly format: Format;
}


export interface ListenOptions {
  offset: number;
  pump?: boolean;
}

// Events

export interface ListenEvent {
  readonly ts: number;
  readonly streamId: string;
  readonly listener: IListener;
  readonly sentBytes: number;
  readonly sentSeconds: number;

}

export interface ListenerLandedEvent {
  readonly stream: Stream;
  readonly req: express.Request;
  readonly res: express.Response;
}
