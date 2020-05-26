import {Logger} from "winston";
import {Readable} from "stream";
import {MasterStreamConfig} from "../types";
import {StreamSources} from "./StreamSources";
import {componentLogger} from "../../logger";
import {TypedEmitterClass} from "../../helpers/events";
import {Chunk, SourceVitals, MasterStreamStatus} from "../../types";
import {masterEvents} from "../events";
import {RewindBuffer} from "../../rewind/RewindBuffer";

interface Events {
  chunk: (chunk: Chunk) => void;
  connected: () => void;
}

export class Stream extends TypedEmitterClass<Events>() {
  private readonly sources: StreamSources;
  private readonly logger: Logger;

  private rewindBuffer?: RewindBuffer;
  private vitals?: SourceVitals;

  private status = MasterStreamStatus.STARTING;

  constructor(
    private readonly id: string,
    private readonly config: MasterStreamConfig,
  ) {
    super();

    this.logger = componentLogger(`stream[${id}]`);

    this.logger.info(`Initialize stream`);

    // We have three options for what source we're going to use:
    // a) Internal: Create our own source mount and manage our own sources.
    //    Basically the original stream behavior.
    // b) Source Mount: Connect to a source mount and use its source
    //    directly. You'll get whatever incoming format the source gets.
    // c) Source Mount w/ Transcoding: Connect to a source mount, but run a
    //    transcoding source between it and us, so that we always get a
    //    certain format as our input.

    this.sources = new StreamSources(this.id, config.sources);

    // Rewind listens to us, not to our source
    // this.rewindBuffer.connectSource(this)
    // this.rewindBuffer.emit("source", this);

    // Pass along buffer loads
    //this.rewindBuffer.on("buffer", (c) => {
    //  return this.emit("buffer", c);
    //});

    this.hookEvents();
  }

  hookEvents() {
    this.sources.on("chunk", chunk => {
      masterEvents().emit('chunk', {
        streamId: this.id,
        chunk
      });
    });

    this.sources.on("connected", this.onSourceConnectionOk);
  }

  onSourceConnectionOk = (vitals: SourceVitals) => {
    this.vitals = vitals;
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
        // set up a rewind buffer, for use in bringing new slaves up to date
        this.rewindBuffer = new RewindBuffer(
          this.id,
          {
            bufferSeconds: this.config.rewind.bufferSeconds,
          },
          this.vitals!
        );

        resolve(this.rewindBuffer);
      });
    });
  }

  async dumpRewindBuffer(): Promise<Readable> {
    return this
      .getRewindBuffer()
      .then(rewindBuffer => {
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
