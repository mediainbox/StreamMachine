import {ListenersCollection} from "./ListenersCollection";
import {Logger} from "winston";

const CLEAN_INTERVAL = 60000;

// We disconnect clients that have fallen too far behind on their
// buffers. Buffer size can be configured via the "max_buffer" setting,
// which takes bits
export class ListenersCleaner {
  private cleanupHandle: NodeJS.Timeout;

  constructor(
    private readonly listeners: ListenersCollection,
    private readonly maxBufferSize: number,
    private readonly logger: Logger,
  ) {
    this.scheduleCheck();
  }

  scheduleCheck() {
    this.cleanupHandle = setInterval(() => {
      let totalBufferSize = 0;

      const count = this.listeners.count();
      this.listeners.toArray().map(listener => {
        const queuedBytes = listener.getQueuedBytes();
        totalBufferSize += queuedBytes;

        if (queuedBytes < this.maxBufferSize) {
          return;
        }

        this.logger.info("connection exceeded max buffer size.", {
          client: listener.id,
          queuedBytes
        });

        listener.disconnect();
      });

      this.logger.debug(`total ${count} queued listeners buffers size: ${totalBufferSize}`);
    }, CLEAN_INTERVAL);
  }

  destroy() {
    clearInterval(this.cleanupHandle);
  }
}
