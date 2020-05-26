import {Kbytes, Milliseconds, Seconds} from "./util";
import {Chunk, Format, IfEnabled} from "./index";
import {DeepReadonly} from "ts-essentials";

export type BaseStreamConfig = DeepReadonly<{
  clientId: string;
  id: string;
  metadata: {
    title: string;
    url: string;
  };
  format: Format;
  rewindBuffer: {
    maxSeconds: Seconds;
  };
  listen: {
    initialBurst: Seconds;
    maxBufferSize: Kbytes;
  };
  analytics: IfEnabled<{
    listenInterval: Seconds;
  }>
  ads: IfEnabled<AdsConfig>;
  geolock: IfEnabled<{
    mode: 'whitelist' | 'blacklist';
    countryCodes: readonly string[]
    fallback: string;
  }>;
}>;

export interface AdsConfig {
  serverUrl: string;
  transcoderUrl: string;
  adTimeout: Milliseconds;
  impressionDelay: Milliseconds;
  prerollKey?: string;
}

export interface StreamChunk {
  readonly streamId: string;
  readonly chunk: Chunk;
}
