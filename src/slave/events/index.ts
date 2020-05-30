import {EventsDefinition, TypedEmitter, TypedEmitterClass} from "../../helpers/events";
import {SlaveStreamsConfig} from "../types/streams";
import {
  SlaveListenerDisconnectEvent,
  SlaveListenerLandedEvent,
  SlaveListenerListenEvent,
  SlaveListenerListenStartEvent
} from "./types";
import {StreamChunk} from "../../types";

let instance: TypedEmitter<SlaveEvents>;

export function slaveEvents(): TypedEmitter<SlaveEvents> {
  if (!instance) {
    instance = new (TypedEmitterClass<SlaveEvents>());
  }

  return instance;
}

export enum SlaveEvent {
  CONNECT_ERROR = 'connect_error',
  CONNECT = 'connect',
  CONFIGURE_STREAMS = 'configure_streams',
  DISCONNECT = 'disconnect',
  CHUNK = 'chunk',
  LISTENER_LANDED = 'listener_landed', // request received, no stream still selected
  LISTENER_START = 'listener_start', // listening started
  LISTENER_LISTEN = 'listener_listen',
  LISTENER_DISCONNECT = 'listener_disconnect',
}

export interface SlaveEvents extends EventsDefinition<SlaveEvent> {
  [SlaveEvent.CONNECT]: () => void;
  [SlaveEvent.CONNECT_ERROR]: (error: Error) => void;
  [SlaveEvent.CONFIGURE_STREAMS]: (streamsConfig: SlaveStreamsConfig) => void;
  [SlaveEvent.DISCONNECT]: () => void;
  [SlaveEvent.CHUNK]: (chunk: StreamChunk) => void;
  [SlaveEvent.LISTENER_LANDED]: (data: SlaveListenerLandedEvent) => void;
  [SlaveEvent.LISTENER_START]: (data: SlaveListenerListenStartEvent) => void;
  [SlaveEvent.LISTENER_LISTEN]: (data: SlaveListenerListenEvent) => void;
  [SlaveEvent.LISTENER_DISCONNECT]: (data: SlaveListenerDisconnectEvent) => void;
}

