import { Readable } from "stream";

export interface PrerollerConfig {
  readonly enabled: boolean;
  readonly streamId: string;
  readonly streamKey: string;
  readonly prerollKey: string;
  readonly timeout: number;
  readonly adUrl: string;
  readonly transcoderUrl: string;
  readonly impressionDelay: number;
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
