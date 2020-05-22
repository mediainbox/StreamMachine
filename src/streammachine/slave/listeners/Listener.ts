import { ListenOptions} from "../types";
import { EventEmitter } from 'events';
import {Logger} from "winston";
import {IOutput} from "../output/IOutput";
import { Client } from "./Client";
import {OutputSource} from "../output/OutputSource";
import {Events, EventsHub} from "../../events";
import {Mutable} from "../../../helpers/types";
import {IListener} from "./IListener";

export class Listener extends EventEmitter implements IListener {
  readonly connectedAt = Date.now();
  readonly client: Client;
  readonly options: ListenOptions;

  private disconnected = false;

  private readonly output: IOutput;
  private readonly logger: Logger;
  private readonly events: EventsHub;

  private readonly listenInterval: number;
  private listenIntervalHandle: NodeJS.Timeout;

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

    this.listenIntervalHandle = setInterval(() => {
      this.events.emit(Events.Listener.LISTEN, this);
    }, this.listenInterval);
  }

  getQueuedBytes() {
    return this.output.getQueuedBytes();
  }

  send(source: OutputSource) {
    this.hookEvents();

    if (this.disconnected) {
      this.logger.debug(`listener disconnected before send, destroy source`);
      source.destroy();
      return;
    }

    this.events.emit(Events.Listener.SESSION_START, this);
    this.output.send(source);
  }

  disconnect = () => {
    if (this.disconnected) {
      return;
    }

    this.logger.debug(`listener disconnected`);
    this.disconnected = true;

    this.output.removeListener('disconnect', this.disconnect);
    clearInterval(this.listenIntervalHandle);
    this.output.disconnect();

    this.emit('disconnect');
    this.removeAllListeners();

    this.events.emit(Events.Listener.DISCONNECT, this);
  }
}
