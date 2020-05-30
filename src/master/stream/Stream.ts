import {Logger} from "winston";
import {Readable} from "stream";
import {StreamSources} from "./sources/StreamSources";
import {componentLogger} from "../../logger";
import {TypedEmitterClass} from "../../helpers/events";
import {Chunk, SourceVitals} from "../../types";
import {masterEvents} from "../events";
import {RewindBuffer} from "../../rewind/RewindBuffer";
import _ from "lodash";
import {difference} from "../../helpers/object";
import {MasterStreamStatus} from "../types/stream";
import {MasterStreamConfig} from "../config/stream";

interface Events {
  chunk: (chunk: Chunk) => void;
  connected: () => void;
  destroy: () => void;
}

export enum MasterStreamState {
  CREATED = 'CREATED',
  CONNECTING = 'CONNECTING',
  CONNECTION_VALIDATE = 'CONNECTION_VALIDATE',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  DESTROYED = 'DESTROYED',
}

export class MasterStream extends TypedEmitterClass<Events>() {
  private readonly sources: StreamSources;
  private readonly logger: Logger;

  private rewindBuffer?: RewindBuffer;
  private vitals: SourceVitals | null = null;
  private lastChunkTs: number | null = null;
  private state = MasterStreamState.CREATED;

  constructor(
    private readonly id: string,
    private readonly config: MasterStreamConfig,
  ) {
    super();

    this.logger = componentLogger(`stream[${id}]`);

    this.logger.info(`Initialize stream`);

    this.sources = new StreamSources({
      streamId: id,
      format: config.format,
      chunkDuration: config.chunkDuration
    }, config.sources);
    this.hookEvents();
  }

  hookEvents() {
    this.sources.on("vitals", this.onSourceConnectionOk);

    this.sources.on("chunk", chunk => {
      masterEvents().emit('chunk', {
        streamId: this.id,
        chunk
      });

      this.lastChunkTs = chunk.ts;
      this.rewindBuffer?.push(chunk);
    });
  }

  configure(config: MasterStreamConfig) {
    if (!_.isEqual(this.config.sources, config.sources)) {
      this.logger.info(`Sources config has changed`);

      this.sources.configure(config.sources);
    } else {
      this.logger.info(`Sources unchanged`);
    }
  }

  onSourceConnectionOk = (vitals: SourceVitals) => {
    this.vitals = vitals;

    // set up a rewind buffer, for use in bringing new slaves up to date
    this.rewindBuffer = new RewindBuffer(
      this.id,
      {
        maxSeconds: this.config.rewindBuffer.maxSeconds,
      },
      vitals
    );

    this.emit("connected");
  };

  getId() {
    return this.id;
  }

  getClientId() {
    return this.config.clientId;
  }

  getConfig(): MasterStreamConfig {
    return this.config;
  }

  getVitals() {
    return this.vitals;
  }

  getStatus(): MasterStreamStatus {
    return {
      id: this.id,
      config: this.config,
      state: this.state,
      vitals: this.vitals,
      lastChunkTs: this.lastChunkTs ? new Date(this.lastChunkTs) : null,
      rewindBuffer: this.rewindBuffer?.getStatus() ?? null,
      sourcesStatus: []
    };
  }

  async getRewindBuffer(): Promise<RewindBuffer> {
    if (this.rewindBuffer) {
      return this.rewindBuffer;
    }

    return new Promise((resolve, reject) => {
      this.runOrWait("connected", () => {
        resolve(this.rewindBuffer);
      });
    });
  }

  async dumpRewindBuffer(): Promise<Readable> {
    return this
      .getRewindBuffer()
      .then(rewindBuffer => {
        this.logger.debug(`Dump RewindBuffer with ${rewindBuffer.getBufferedSeconds()} seconds`);

        return rewindBuffer.dump();
      });
  }

  destroy() {
    this.logger.info('Stream destroy');

    // shut down our sources and go away
    //this.destroying = true;

    this.state = MasterStreamState.DESTROYED;

    this.rewindBuffer?.destroy();
    this.sources.destroy();
    //this.source.removeListener("data", this.dataFunc);
    //this.source.removeListener("vitals", this.vitalsFunc);

    this.emit("destroy");
  }
}
