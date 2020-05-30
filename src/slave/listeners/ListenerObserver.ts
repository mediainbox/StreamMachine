import {IListener} from "./IListener";
import {SlaveEvent, slaveEvents} from "../events";
import {diffSeconds, now, nowTs, toDateTimeStr} from "../../helpers/datetime";
import {DateTimeStr, Kbytes, Seconds, Timestamp} from "../../types/util";
import {SlaveStream} from "../stream/Stream";
import {IOutput} from "../output/IOutput";

export class ListenerObserver {
  private listenIntervalHandle?: NodeJS.Timeout;

  private sentKbytes: Kbytes = 0;
  private startedAt: Timestamp = null!;
  private startedAtStr: DateTimeStr = null!;
  private lastListenAt: Timestamp = null!;

  constructor(
    private readonly stream: SlaveStream,
    private readonly listener: IListener,
    private readonly output: IOutput,
    private readonly listenInterval: Seconds,
  ) {
    this.hookEvents();
  }

  hookEvents() {
    this.listener.on('start', this.handleStart);
    this.listener.on('disconnect', this.handleDisconnect);
  }

  updateStats(): { kbytes: Kbytes, duration: Seconds } {
    const ts = nowTs();
    const duration = diffSeconds(this.lastListenAt || this.startedAt, ts);
    const intervalKbytes = this.listener.getSentBytes() / 1024 as Kbytes;
    const kbytes = (intervalKbytes - this.sentKbytes) as Kbytes;

    // set updated stats
    this.lastListenAt = ts;
    this.sentKbytes = intervalKbytes;

    return {
      kbytes,
      duration,
    };
  }

  handleStart = () => {
    this.startedAt = nowTs();
    this.startedAtStr = toDateTimeStr(this.startedAt);
    this.listenIntervalHandle = setInterval(this.emitListen, this.listenInterval * 1000);

    slaveEvents().emit(SlaveEvent.LISTENER_START, {
      datetime: this.startedAtStr,
      stream: this.stream,
      listener: this.listener,
      output: this.output,
    });
  };

  emitListen = () => {
    const { kbytes, duration } = this.updateStats();

    slaveEvents().emit(SlaveEvent.LISTENER_LISTEN, {
      datetime: toDateTimeStr(this.lastListenAt),
      startedAt: this.startedAtStr!,
      stream: this.stream,
      listener: this.listener,
      output: this.output,
      kbytes,
      duration,
      session: {
        duration: diffSeconds(this.startedAt, this.lastListenAt),
        kbytes: this.sentKbytes,
      }
    });
  };

  handleDisconnect = () => {
    this.listenIntervalHandle && clearInterval(this.listenIntervalHandle);
    this.listener.off('start', this.handleStart);
    this.listener.off('disconnect', this.handleDisconnect);

    const { kbytes, duration } = this.updateStats();

    slaveEvents().emit(SlaveEvent.LISTENER_DISCONNECT, {
      startedAt: this.startedAtStr,
      datetime: now(),
      stream: this.stream,
      listener: this.listener,
      output: this.output,
      lastListen: {
        kbytes,
        duration
      },
      session: {
        duration: diffSeconds(this.startedAt, this.lastListenAt),
        kbytes: this.sentKbytes,
      }
    });
  };
}
