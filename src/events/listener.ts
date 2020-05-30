import {DateTimeStr, Kbytes, Seconds, Timestamp} from "../types/util";
import {ClientData} from "../types";

export enum ListenerEventType {
  LISTENER_START = 'listener_start',
  LISTENER_LISTEN = 'listener_listen',
  LISTENER_DISCONNECT = 'listener_disconnect',
}

export interface ListenerEvents {
  [ListenerEventType.LISTENER_START]: (data: ListenerStartEventData) => void;
  [ListenerEventType.LISTENER_LISTEN]: (data: ListenerListenEventData) => void;
  [ListenerEventType.LISTENER_DISCONNECT]: (data: ListenerDisconnectEventData) => void;
}

// common data among all listening events
// duration/kbytes relate to the interval of the event
// for session: amount since start
// for listen: amount since event datetime - duration
export interface BaseEventData {
  readonly groupId: string;
  readonly streamId: string;
  readonly datetime: DateTimeStr;
  readonly sessionId: string;
  readonly listenerId: string;
  readonly outputType: string;
  readonly client: ClientData;
}

export interface ListenerStartEventData extends BaseEventData {
}

export interface ListenerListenEventData extends BaseEventData {
  readonly duration: Seconds;
  readonly kbytes: Kbytes;

  // include related session data
  readonly session: {
    readonly start: DateTimeStr
    readonly kbytes: Kbytes;
    readonly duration: Seconds;
  };
}

export interface ListenerDisconnectEventData extends BaseEventData {
  // include related session data
  readonly session: {
    readonly start: DateTimeStr
    readonly kbytes: Kbytes;
    readonly duration: Seconds;
  };

  readonly lastListen: {
    readonly duration: Seconds;
    readonly kbytes: Kbytes;
  }
}
