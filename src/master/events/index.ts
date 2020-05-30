import {EventsDefinition, TypedEmitter, TypedEmitterClass} from "../../helpers/events";
import {MasterStream} from "../stream/Stream";
import {SourceConfig} from "../config/source";
import {ISource} from "../sources/base/ISource";
import {MasterStreamConfig} from "../config/stream";
import {StreamChunk} from "../../types";

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
  SOURCE_CREATED = 'source_created',
  SOURCE_UPDATED = 'source_updated',
  SOURCE_DELETED = 'source_deleted',
  SOURCE_PROMOTED = 'source_promoted',
}

export interface Events extends EventsDefinition<MasterEvent> {
  chunk: (chunk: StreamChunk) => void;
  stream_created: (stream: MasterStream) => void;
  stream_updated: (stream: MasterStream, oldConfig: MasterStreamConfig) => void;
  stream_deleted: (stream: MasterStream) => void;
  source_created: (source: ISource) => void;
  source_updated: (source: ISource, oldConfig: SourceConfig) => void;
  source_deleted: (source: ISource) => void;
  source_promoted: (newSource: ISource, oldSource: ISource | null) => void;
}
