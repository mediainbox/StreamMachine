import {EventEmitter} from "events";
import {Arguments} from "./types";

export function passthrough(_events: string | string[], source: EventEmitter, target: EventEmitter) {
  const events = Array.isArray(_events) ? _events : [_events];

  events.forEach(event => {
    source.on(event, (...args) => target.emit(event, ...args));
  });
}

export class BetterEventEmitter extends EventEmitter {
  __emitted: Record<string, any> = {};

  emit(evt: string, ...args: any[]) {
    this.__emitted[evt] = args;
    return super.emit(evt, ...args);
  }

  runOrWait(evt: any, listener: (...args: any[]) => void) {
    if (this.__emitted[evt]) {
      listener(...this.__emitted[evt]);
      return;
    }

    return this.once(evt, listener);
  }
}

export interface TypedEmitter<Events> {
  addListener<E extends keyof Events> (event: E, listener: Events[E]): this;
  on<E extends keyof Events> (event: E, listener: Events[E]): this;
  once<E extends keyof Events> (event: E, listener: Events[E]): this;
  prependListener<E extends keyof Events> (event: E, listener: Events[E]): this;
  prependOnceListener<E extends keyof Events> (event: E, listener: Events[E]): this;

  off<E extends keyof Events>(event: E, listener: Events[E]): this;
  removeAllListeners<E extends keyof Events> (event?: E): this;
  removeListener<E extends keyof Events> (event: E, listener: Events[E]): this;

  emit<E extends keyof Events> (event: E, ...args: Arguments<Events[E]>): boolean;
  eventNames (): (keyof Events | string | symbol)[];
  listeners<E extends keyof Events> (event: E): Function[];
  rawListeners<E extends keyof Events> (event: E): Function[];
  listenerCount<E extends keyof Events> (event: E): number;

  getMaxListeners (): number;
  setMaxListeners (maxListeners: number): this;

  runOrWait<E extends keyof Events> (event: E, listener: Events[E]): this;
}

export function TypedEmitterClass<Events>(): { new(): TypedEmitter<Events> } {
  return BetterEventEmitter as any;
}

export type EventsDefinition<Type extends string> = {
  [P in Type]: (...args: any[]) => void;
};
