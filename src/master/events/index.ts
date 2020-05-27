import {EventsDefinition, TypedEmitter, TypedEmitterClass} from "../../helpers/events";
import {StreamChunk} from "../../types/stream";
import {MasterStream} from "../stream/Stream";
import {MasterStreamConfig} from "../types/config";

let instance: TypedEmitter<Events>;

export function masterEvents(): TypedEmitter<Events> {
  if (!instance) {
    instance = new (TypedEmitterClass<Events>());
  }

  return instance;
}

export enum MasterEvent {
  CHUNK = 'chunk',
  STREAM_CREATED = 'stream_created',
  STREAM_UPDATED = 'stream_updated',
  STREAM_DELETED = 'stream_deleted',
}

export interface Events extends EventsDefinition<MasterEvent> {
  chunk: (chunk: StreamChunk) => void;
  stream_created: (stream: MasterStream) => void;
  stream_updated: (stream: MasterStream, oldConfig: MasterStreamConfig) => void;
  stream_deleted: (stream: MasterStream) => void;
}
