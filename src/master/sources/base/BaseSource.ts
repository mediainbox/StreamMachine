import {TypedEmitterClass} from "../../../helpers/events";
import {ISource, SourceEvents} from "./ISource";
import {BaseSourceConfig, SourceConfig} from "../../config/source";
import {SourceState, SourceStatus, SourceVitals} from "../../../types";
import {Logger} from "winston";
import {toTime} from "../../../helpers/datetime";

export function sourceLabel(config: SourceConfig): string {
  return `${config.name || `#${config.id}`}(${config.type})`
}

export abstract class BaseSource<Config extends SourceConfig> extends TypedEmitterClass<SourceEvents>() implements ISource<Config> {
  protected state: SourceState = SourceState.CREATED;
  protected lastChunkTs: number | null = null;
  protected vitals: SourceVitals | null = null;

  protected constructor(
    protected readonly config: Config,
    protected readonly logger: Logger,
  ) {
    super();

    this.hookEvents();

    // allow child class to finish setup
    process.nextTick(() => {
      this.connect();
    });
  }

  hookEvents() {
    this.on("connect_error", error => {
      this.logger.error(`Source got connect error`, {
        error
      });
      this.state = SourceState.CONNECTION_ERROR;
    });

    this.on("connect", () => {
      this.logger.info(`Source connected`);
      this.state = SourceState.CONNECTED;
    });

    this.on("vitals", vitals => {
      this.logger.info(`Source got vitals`, {
        vitals
      });
      this.vitals = vitals;
    });

    this.on("chunk", chunk => {
      this.logger.silly(`Source got chunk: ${toTime(chunk.ts)}`);
      this.lastChunkTs = chunk.ts;
    });

    this.on("disconnect", () => {
      this.logger.info('Source disconnected');
      this.state = SourceState.DISCONNECTED;
    });

    this.on("destroy", () => {
      this.logger.info('Source destroyed');
      this.state = SourceState.DESTROYED;
    });
  }

  getId() {
    return this.config.id;
  }

  getLabel() {
    return sourceLabel(this.config);
  }

  getPriority() {
    return this.config.priority;
  }

  getConfig() {
    return this.config;
  }

  isConnected() {
    return this.state === SourceState.CONNECTED;
  }

  getStatus() {
    return {
      id: this.config.id,
      type: this.config.type,
      state: this.state,
      config: this.config,
      vitals: this.vitals,
      lastChunkTs: this.lastChunkTs,
    };
  }

  abstract configure(config: Config): void;

  abstract connect(): void;

  abstract disconnect(): void;

  abstract destroy(): void;
}
