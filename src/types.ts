export interface Err extends Error {
  context?: any;
  code?: string;
}

export interface Chunk {
  readonly ts: number;
  readonly duration: number;
  readonly meta: {},
  readonly data: Buffer;
}
