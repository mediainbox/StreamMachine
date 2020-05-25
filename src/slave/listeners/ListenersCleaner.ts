import {ListenersCollection} from "./ListenersCollection";
import {Logger} from "winston";
import {Kbytes} from "../../types/util";
import {componentLogger} from "../../logger";

const CLEAN_INTERVAL = 60000;

// We disconnect clients that have fallen too far behind on their
// buffers. Buffer size can be configured via the "max_buffer" setting,
// which takes bits
export class ListenersCleaner {
  private cleanupHandle: NodeJS.Timeout;
  private readonly logger: Logger;

  constructor(
    private readonly streamId: string,
    private readonly listeners: ListenersCollection,
    private readonly maxBufferSize: Kbytes,
  ) {
    this.logger = componentLogger(`listeners_cleaner[${streamId}]`);
    this.scheduleCheck();
  }

  scheduleCheck() {
    this.cleanupHandle = setInterval(() => {
      let totalBufferSize = 0;

      this.listeners.toArray().map(listener => {
        const queuedBytes = listener.getQueuedBytes();
        totalBufferSize += queuedBytes;

        if (queuedBytes < this.maxBufferSize * 1024) {
          return;
        }

        this.logger.info("connection exceeded max buffer size.", {
          client: listener.id,
          queuedBytes
        });

        listener.disconnect();
      });

      this.logger.debug(`total queued buffer size: ${totalBufferSize}`);
    }, CLEAN_INTERVAL);
  }

  destroy() {
    clearInterval(this.cleanupHandle);
  }
}
