import { Readable } from "stream";

export interface PrerollerConfig {
  streamKey: string;
  streamId: string;
  type: 'VAST' | 'DAAST';
  adUrl: string;
  adRequestTimeout: number;
  transcoderUrl: string;
  impressionDelay: number;
}

export interface ListenerInfo {
  readonly clientIp: string;
  readonly clientUA: string;
  readonly sessionId: string;
}


export interface IAdOperator {
  build(): Promise<Readable>;
  abort(): void;
}
