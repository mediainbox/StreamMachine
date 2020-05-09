const { EventEmitter } = require('events');

module.exports = class BetterEventEmitter extends EventEmitter {

  __emitted = {};

  emit(evt, ...args) {
    this.__emitted[evt] = args;
    return super.emit(evt, ...args);
  }

  runOrWait(evt, listener) {
    if (this.__emitted[evt]) {
      listener(...this.__emitted[evt]);
      return;
    }

    return this.once(evt, listener);
  }

}
