export interface Err extends Error {
  context?: any;
  code?: string;
}

export interface Chunk {
  readonly ts: number;
  readonly duration: number;
  readonly meta: {
    readonly StreamTitle: string;
    readonly StreamUrl: string;
  };
  readonly data: Buffer;
  readonly frames: number;
  readonly streamKey: string;
}

export interface WsAudioMessage {
  readonly stream: string;
  readonly chunk: Chunk;
}
