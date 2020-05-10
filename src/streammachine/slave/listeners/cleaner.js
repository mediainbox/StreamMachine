const CLEAN_INTERVAL = 60000;

module.exports = class ListenersCleaner {
  constructor({ listeners, ctx, key, maxBuffer }) {
    this.listeners = listeners;
    this.logger = ctx.logger.child({
      component: `listeners-cleaner[${key}]`
    });
    this.maxBuffer = maxBuffer;

    this.scheduleCheck();
  }

  scheduleCheck() {
    this.cleanupHandle = setInterval(() => {
      let totalBufferSize = 0;

      const count = this.listeners.count();
      this.listeners.toArray().map(listener => {
        const queuedBytes = listener.getQueuedBytes();
        totalBufferSize += queuedBytes;

        if (queuedBytes < this.maxBuffer) {
          return;
        }

        this.logger.info("connection exceeded max buffer size.", {
          client: listener.client,
          queuedBytes
        });

        listener.disconnect();
      });

      this.logger.debug(`total ${count} queued listeners buffers size: ${totalBufferSize}`);
    }, CLEAN_INTERVAL);
  }

  disconnect() {
    clearInterval(this.cleanupHandle);
  }
}
