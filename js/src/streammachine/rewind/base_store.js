var BaseStore;

module.exports = BaseStore = class BaseStore extends require("events").EventEmitter {
  setMax(l) {
    this.max_length = l;
    return this._truncate();
  }

  length() {}

  at(i) {}

  insert(chunk) {}

  info() {}

};

//# sourceMappingURL=base_store.js.map
