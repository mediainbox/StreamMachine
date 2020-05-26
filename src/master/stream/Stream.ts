import {Logger} from "winston";
import {Readable} from "stream";
import {MasterStreamConfig} from "../types";
import {StreamSources} from "./StreamSources";
import {componentLogger} from "../../logger";
import {TypedEmitterClass} from "../../helpers/events";
import {Chunk, SourceVitals} from "../../types";
import {masterEvents} from "../events";
import {RewindBuffer} from "../../rewind/RewindBuffer";

interface Events {
  chunk: (chunk: Chunk) => void;
  connected: () => void;
}

export enum MasterStreamStatus {
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
  private vitals?: SourceVitals;
  private status = MasterStreamStatus.CREATED;

  constructor(
    private readonly id: string,
    private readonly config: MasterStreamConfig,
  ) {
    super();

    this.logger = componentLogger(`stream[${id}]`);

    this.logger.info(`Initialize stream`);

    this.sources = new StreamSources(config, config.sources);
    this.hookEvents();
  }

  hookEvents() {
    this.sources.on("connected", this.onSourceConnectionOk);

    this.sources.on("chunk", chunk => {
      masterEvents().emit('chunk', {
        streamId: this.id,
        chunk
      });

      this.rewindBuffer?.push(chunk);
    });
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

  getConfig() {
    return this.config;
  }

  getVitals() {
    return this.vitals;
  }

  getStatus() {
    return {
      // id is DEPRECATED in favor of key
      key: this.id,
      id: this.id,
      //vitals: this._vitals,
      //source: this.source.status(),
      //rewind: this.rewindBuffer.getStatus()
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
    // shut down our sources and go away
    //this.destroying = true;

    this.rewindBuffer?.destroy();
    //this.source.removeListener("data", this.dataFunc);
    //this.source.removeListener("vitals", this.vitalsFunc);

    //this.emit("destroy");
  }
}
