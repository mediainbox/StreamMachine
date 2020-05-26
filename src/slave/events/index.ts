import {Stream} from "../stream/Stream";
import express from "express";
import {StreamChunk} from "../../master/types";
import {EventsDefinition, TypedEmitter, TypedEmitterClass} from "../../helpers/events";
import {IListener} from "../listeners/IListener";
import {SlaveStreamsConfig} from "../types/streams";

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
  LISTENER_LANDED = 'listener_landed',
  LISTENER_SESSION_START = 'listener_session_start',
  LISTENER_LISTEN = 'listener_listen',
  LISTENER_DISCONNECT = 'listener_disconnect',
}

export interface SlaveEvents extends EventsDefinition<SlaveEvent> {
  connect: () => void;
  connect_error: (error: Error) => void;
  configure_streams: (streamsConfig: SlaveStreamsConfig) => void;
  disconnect: () => void;
  chunk: (chunk: StreamChunk) => void;
  listener_landed: (args: { stream: Stream, req: express.Request, res: express.Response }) => void;
  listener_session_start: (listener: IListener) => void;
  listener_listen: (data: ListenEventData) => void;
  listener_disconnect: (listener: IListener) => void;
}

export interface ListenerLandedEvent {
  readonly stream: Stream;
  readonly req: express.Request;
  readonly res: express.Response;
}

export interface ListenEventData {
  readonly listener: IListener;
  readonly ts: number;
  readonly streamId: string;
  readonly sentBytes: number;
  readonly sentSeconds: number;
}
