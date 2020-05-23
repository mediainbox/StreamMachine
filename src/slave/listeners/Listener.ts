import {ListenEvent, ListenOptions} from "../types";
import {EventEmitter} from 'events';
import {Logger} from "winston";
import {IOutput} from "../output/IOutput";
import {Client} from "./Client";
import {Events, EventsHub} from "../../events";
import {Mutable} from "../../helpers/types";
import {IListener} from "./IListener";
import {ISource} from "../output/ISource";

export class Listener extends EventEmitter implements IListener {
  readonly connectedAt = Date.now();
  readonly client: Client;
  readonly options: ListenOptions;

  private disconnected = false;

  private readonly source: ISource;
  private readonly output: IOutput;
  private readonly logger: Logger;
  private readonly events: EventsHub;

  private readonly listenInterval: number;
  private listenIntervalHandle: NodeJS.Timeout;

  private sentBytes = 0;
  private sentSeconds = 0;

  constructor(
    readonly streamId: string,
    readonly id: string,
  ) {
    super();
  }

  setClient(client: Client): this {
    (this.client as Mutable<Client>) = client;
    return this;
  }

  setOutput(output: IOutput): this {
    (this.output as Mutable<IOutput>) = output;
    return this;
  }

  setOptions(options: ListenOptions): this {
    (this.options as Mutable<ListenOptions>) = options;
    return this;
  }

  setLogger(logger: Logger): this {
    (this.logger as Mutable<Logger>) = logger;
    return this;
  }

  setEvents(events: EventsHub): this {
    (this.events as Mutable<EventsHub>) = events;
    return this;
  }

  setListenInterval(listenInterval: number): this {
    (this.listenInterval as Mutable<number>) = listenInterval;
    return this;
  }

  hookEvents() {
    this.output.once('disconnect', this.disconnect);

    this.listenIntervalHandle = setInterval(this.emitListen, this.listenInterval);
  }

  emitListen = () => {
    const sentBytes = this.output.getSentBytes();
    const sentSeconds = this.output.getSentSeconds();

    this.events.emit(Events.Listener.LISTEN, {
      ts: Date.now(),
      streamId: this.streamId,
      sentBytes: sentBytes - this.sentBytes,
      sentSeconds: sentSeconds - this.sentSeconds,
      listener: this,
    } as ListenEvent);

    this.sentBytes = sentBytes;
    this.sentSeconds = sentSeconds;
  }

  getQueuedBytes() {
    return this.output.getQueuedBytes();
  }

  getSentBytes() {
    return this.output.getSentBytes();
  }

  getSentSeconds() {
    return this.output.getSentSeconds();
  }

  getSource() {
    return this.source;
  }

  send(source: ISource) {
    this.hookEvents();

    if (this.disconnected) {
      this.logger.debug(`listener disconnected before send, destroy source`);
      source.destroy();
      return;
    }

    (this.source as Mutable<ISource>) = source;
    this.events.emit(Events.Listener.SESSION_START, this);
    this.output.send(source);
  }

  disconnect = () => {
    if (this.disconnected) {
      return;
    }

    this.emitListen();
    clearInterval(this.listenIntervalHandle);

    this.logger.debug(`listener disconnected`);
    this.events.emit(Events.Listener.DISCONNECT, this);
    this.disconnected = true;

    this.output.removeListener('disconnect', this.disconnect);
    this.output.disconnect();

    this.emit('disconnect');
    this.removeAllListeners();
  }
}
