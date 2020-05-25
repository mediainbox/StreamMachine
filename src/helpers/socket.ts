import { Arguments } from "./types";
import {Namespace, Socket} from "socket.io";

export type SocketServerEvents<Inbound> = Inbound & {
  disconnect: () => void;
};

export type SocketClientEvents<Inbound> = Inbound & {
  connect: () => void;
  connect_error: (error: Error) => void;
  disconnect: () => void;
};

export interface TypedSocketClient<Outbound, Inbound> {
  addEventListener<E extends keyof Inbound> (event: E, listener: Inbound[E]): this;
  on<E extends keyof Inbound> (event: E, listener: Inbound[E]): this;
  once<E extends keyof Inbound> (event: E, listener: Inbound[E]): this;

  off<E extends keyof Inbound>(event: E, listener?: Inbound[E]): this;
  removeListener<E extends keyof Inbound> (event: E, listener?: Inbound[E]): this;
  removeEventListener<E extends keyof Inbound> (event: E, listener?: Inbound[E]): this;
  removeAllListeners(): this;

  listeners<E extends keyof Inbound> (event: E): Function[];
  hasListeners<E extends keyof Inbound> (event: E): boolean;

  emit<E extends keyof Outbound> (event: E, ...args: Arguments<Outbound[E]>): this;
}

type TypedNamespace = Namespace;

export interface TypedSocketServer<Outbound, Inbound> {
  //addEventListener<E extends keyof Inbound> (event: E, listener: Inbound[E]): this;
  on<E extends keyof Inbound> (event: E, listener: Inbound[E]): this;
  once<E extends keyof Inbound> (event: E, listener: Inbound[E]): this;

  off<E extends keyof Inbound>(event: E, listener?: Inbound[E]): this;
  removeListener<E extends keyof Inbound> (event: E, listener?: Inbound[E]): this;
  //removeEventListener<E extends keyof Inbound> (event: E, listener?: Inbound[E]): this;
  removeAllListeners(): this;

  listeners<E extends keyof Inbound> (event: E): Function[];
  //hasListeners<E extends keyof Inbound> (event: E): boolean;

  emit<E extends keyof Outbound> (event: E, ...args: Arguments<Outbound[E]>): this;

  //prependListener<E extends keyof Events> (event: E, listener: Events[E]): this;
  //prependOnceListener<E extends keyof Events> (event: E, listener: Events[E]): this;

  //eventNames (): (keyof Events | string | symbol)[];
  //listeners<E extends keyof Events> (event: E): Function[];
  //listenerCount<E extends keyof Events> (event: E): number;

  //getMaxListeners (): number;
  //setMaxListeners (maxListeners: number): this;
}
