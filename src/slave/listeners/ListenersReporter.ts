import {ListenersCollection} from "./ListenersCollection";
import {Logger} from "winston";
import {round} from "../../helpers/number";
import {componentLogger} from "../../logger";

const REPORT_INTERVAL = 10000;

export class ListenersReporter {
  private reportHandle?: NodeJS.Timeout;
  private prevSentKbytes = 0;
  private prevSentSeconds = 0;

  private readonly logger: Logger;

  constructor(
    private readonly streamId: string,
    private readonly listeners: ListenersCollection,
    private readonly enabled = true,
  ) {
    this.logger = componentLogger(`listeners_reporter[${streamId}]`);

    if (enabled) {
      this.scheduleReport();
    }
  }

  scheduleReport() {
    this.reportHandle = setInterval(() => {
      const count = this.listeners.count();

      let totalSentBytes = 0;
      let totalSentSeconds = 0;

      this.listeners.toArray().map(listener => {
        totalSentBytes += listener.getSentBytes();
        totalSentSeconds += listener.getSentSeconds();
      });

      const sentBytes = totalSentBytes - this.prevSentKbytes;
      const sentSeconds = totalSentSeconds - this.prevSentSeconds;
      this.prevSentKbytes = totalSentBytes;
      this.prevSentSeconds = totalSentSeconds;

      const sentKbytes = round(sentBytes / 1024, 2);
      const sentMbytes = round(sentKbytes / 1024, 2);
      const avgSentKbytes = count ? round(sentKbytes / count, 2) : 0;
      const avgSentSeconds = count ? round(sentSeconds / count, 2) : 0;
      const avgRate = count ? round(avgSentKbytes / avgSentSeconds, 2) : 0;

      this.logger.info(`[report] >>> active listeners: ${count}`);
      this.logger.info(`[report] >>> past 5 seconds:`);
      this.logger.info(`[report] sent kB: ${sentKbytes} (mB: ${sentMbytes}), avg: ${avgSentKbytes}`);
      this.logger.info(`[report] sent seconds: ${round(sentSeconds, 2)}, avg: ${avgSentSeconds}`);
      this.logger.info(`[report] avg rate: ${avgRate} kB/s`);
    }, REPORT_INTERVAL);
  }

  destroy() {
    this.reportHandle && clearInterval(this.reportHandle);
  }
}
