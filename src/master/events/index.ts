import {EventsDefinition, TypedEmitter, TypedEmitterClass} from "../../helpers/events";
import {StreamChunk} from "../../types/stream";

let instance: TypedEmitter<Events>;

export function masterEvents(): TypedEmitter<Events> {
  if (!instance) {
    instance = new (TypedEmitterClass<Events>());
  }

  return instance;
}

export enum MasterEvent {
  CHUNK = 'chunk',
}

export interface Events extends EventsDefinition<MasterEvent> {
  chunk: (chunk: StreamChunk) => void;
}
