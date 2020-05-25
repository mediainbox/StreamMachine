import {EventsDefinition} from "../../helpers/events";

export interface StreamEvents extends EventsDefinition<StreamEvent> {
  rewind_loaded: () => void;
  config: () => void;
  disconnect: () => void;
}

export enum StreamEvent {
 REWIND_LOADED = 'rewind_loaded',
 CONFIG = 'config',
 DISCONNECT = 'disconnect',
}
