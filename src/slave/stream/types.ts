import {EventsDefinition} from "../../helpers/events";

export interface StreamEvents extends EventsDefinition<StreamEvent> {
  rewind_loaded: () => void;
  config: () => void;
  disconnect: () => void;
}

export enum StreamEvent {
 READY = 'ready',
 CONFIG = 'config',
 DISCONNECT = 'disconnect',
}

export enum SlaveStreamStatus {
  CREATED = 'CREATED',
  REWIND_LOADING = 'REWIND_LOADING',
  READY = 'READY', // ready to serve
  DESTROYED = 'DESTROYED'
}
