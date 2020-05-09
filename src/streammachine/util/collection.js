module.exports = class Collection {
  map = {};

  constructor() {}

  toArray() {
    return Object.values(this.map);
  }

  get(key) {
    return this.map[key];
  }

  keys() {
    return Object.keys(this.map);
  }

  add(key, element) {
    this.map[key] = element;
  }

  remove(key) {
    const element = this.map[key];
    delete this.map[key];
    return element;
  }

  count() {
    return this.keys().length;
  }

  first() {
    if (!this.count()) {
      return null;
    }

    return this.map[this.keys()[0]];
  }
}
