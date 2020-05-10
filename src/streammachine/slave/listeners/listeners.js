const Collection = require('../../util/collection');

module.exports = class Listeners extends Collection {
  disconnectAll() {
    this.listeners.toArray().map(listener => {
      listener.disconnect();
    });
  }

  disconnectListener(id) {
    const listener = this.listeners.disco(id);

    if (!listener) {
      console.error(`disconnectListener called for ${id}, but no listener found.`);
    }
  }
}
