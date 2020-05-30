import {Kbytes, Seconds, DateTimeStr} from "../../types/util";
import {ClientData} from "../../types";
import {PickPartial} from "../../helpers/types";

export interface SessionData {
  readonly sessionId: string;
  readonly groupId: string;
  readonly start: DateTimeStr;
  readonly end: DateTimeStr;
  readonly finished: boolean;
  readonly streamId: string;
  readonly listenerId: string;
  readonly duration: Seconds;
  readonly kbytes: Kbytes;
  readonly outputType: string;
  readonly client: ClientData;
  readonly _createdAt: DateTimeStr;
  readonly _updatedAt: DateTimeStr;
}

export interface ListenData {
  readonly groupId: string;
  readonly datetime: DateTimeStr;
  readonly sessionId: string;
  readonly streamId: string;
  readonly listenerId: string;
  readonly duration: Seconds;
  readonly kbytes: Kbytes;
  readonly outputType: string;
  readonly client: ClientData;
  readonly session: {
    readonly start: DateTimeStr;
    readonly kbytes: Kbytes;
    readonly duration: Seconds;
  };
  readonly _createdAt: DateTimeStr;
  readonly _updatedAt: DateTimeStr;
}

export interface IStore {
  initialize(): Promise<void>;

  createSession(data: SessionData): Promise<void>;

  updateSession(data: PickPartial<SessionData, 'sessionId'>): Promise<void>;

  createListen(data: ListenData): Promise<void>;
}
