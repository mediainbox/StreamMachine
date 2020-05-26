import {SocketClientEvents, SocketServerEvents, TypedSocketClient, TypedSocketServer} from "../helpers/socket";
import {SlaveStreamsConfig} from "../slave/types/streams";
import SocketIOClient from "socket.io-client";
import {EventsDefinition} from "../helpers/events";
import SocketIO from "socket.io";
import {StreamChunk} from "../types/stream";

export enum MasterWsMessage { // master -> slave
  STREAMS = 'streams',
  CHUNK = 'chunk',
}

export interface MasterWsMessages extends EventsDefinition<MasterWsMessage> {
  streams: (config: SlaveStreamsConfig) => void;
  chunk: (chunk: StreamChunk) => void;
}

export enum SlaveWsMessage { // slave -> master
  CONNECTION_VALIDATE = 'connection_validate',
  ALICE = 'alive',
}

export interface SlaveWsMessages extends EventsDefinition<MasterWsMessage> {
  connection_validate: (fn: (response: string) => void) => void;
  alive: () => void;
}

type SlaveWsEmitter = TypedSocketClient<SlaveWsMessages, SocketClientEvents<MasterWsMessages>>;
export type SlaveWsSocket = Omit<SocketIOClient.Socket, keyof SlaveWsEmitter> & SlaveWsEmitter;

type MasterWsEmitter = TypedSocketServer<MasterWsMessages, SocketServerEvents<SlaveWsMessages>>;
export type MasterWsSocket = Omit<SocketIO.Socket, keyof MasterWsEmitter> & MasterWsEmitter;
