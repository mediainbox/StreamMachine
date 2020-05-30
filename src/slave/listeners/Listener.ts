import {Logger} from "winston";
import {IOutput} from "../output/IOutput";
import {Mutable} from "../../helpers/types";
import {IListener} from "./IListener";
import {ISource} from "../output/ISource";
import {ListenOptions} from "../types";
import {Bytes, Seconds} from "../../types/util";
import {TypedEmitterClass} from "../../helpers/events";
import {ClientData} from "../../types";

interface Events {
  start: () => void;
  disconnect: () => void;
}

export class Listener extends TypedEmitterClass<Events>() implements IListener {
  private readonly source: ISource = null!;
  private readonly output: IOutput = null!;
  private readonly logger: Logger = null!;

  private started = false;
  private disconnected = false;

  constructor(
    private readonly id: string,
    private readonly sessionId: string,
    private readonly client: ClientData,
    private readonly options: ListenOptions,
  ) {
    super();
  }

  setOutput(output: IOutput): this {
    (this.output as Mutable<IOutput>) = output;
    return this;
  }

  setLogger(logger: Logger): this {
    (this.logger as Mutable<Logger>) = logger;
    return this;
  }

  getId() {
    return this.id;
  }

  getSessionId() {
    return this.sessionId;
  }

  getOptions() {
    return this.options;
  }

  getClient() {
    return this.client;
  }

  getQueuedBytes(): Bytes {
    return this.output.getQueuedBytes();
  }

  getSentBytes(): Bytes {
    return this.output.getSentBytes();
  }

  getSentSeconds(): Seconds {
    return this.output.getSentSeconds();
  }

  getSource(): ISource {
    return this.source;
  }

  send(source: ISource) {
    this.output.once('disconnect', this.disconnect);

    if (this.disconnected) {
      this.logger.debug(`listener disconnected before send, destroy source`);
      source.destroy();
      return;
    }

    (this.source as Mutable<ISource>) = source;
    this.output.send(source);

    this.started = true;
    this.emit('start');
  }

  disconnect = () => {
    if (this.disconnected) {
      return;
    }

    this.disconnected = true;

    this.emit('disconnect');
    this.logger.debug(`Listener disconnected`);

    this.output.disconnect();
    this.removeAllListeners();
  }
}
