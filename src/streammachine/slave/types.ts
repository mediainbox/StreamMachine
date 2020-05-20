export interface Client {
  readonly sessionId: string;
  readonly ip: string;
  readonly ua: string;
}

export interface IListener {
  getId(): string;
  getClient(): Client;
}
