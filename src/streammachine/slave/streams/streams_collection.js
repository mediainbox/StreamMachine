module.exports = class StreamsCollection {

  map = {};

  constructor() {

  }

  toArray() {
    return Object.values(this.map);
  }

  get(key) {
    return this.map[key];
  }

  keys() {
    return Object.keys(this.map);
  }

  add(key, stream) {
    this.map[key] = stream;
  }

  remove(key) {
    const stream = this.map[key];
    delete this.map[key];
    return stream;
  }

  length() {
    return this.keys().length;
  }

  first() {
    if (!this.length()) {
      return null;
    }

    return this.map[this.keys()[0]];
  }
}
