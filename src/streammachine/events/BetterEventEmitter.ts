import { EventEmitter } from 'events';

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
