import {Logger} from "winston";
import {Readable} from "stream";
import {MasterStreamConfig} from "../types";
import {StreamSources} from "./StreamSources";
import {componentLogger} from "../../logger";
import {TypedEmitterClass} from "../../helpers/events";
import {Chunk, SourceVitals} from "../../types";
import {masterEvents} from "../events";

const RewindBuffer = require('../../rewind/RewindBuffer');

interface Events {
  chunk: (chunk: Chunk) => void;
}

export class Stream extends TypedEmitterClass<Events>() {
  private readonly sources: StreamSources;
  private readonly rewindBuffer: any;
  private readonly logger: Logger;
  private vitals: SourceVitals | null = null;

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

    // set up a rewind buffer, for use in bringing new slaves up to date
    // TODO: initialize only on vitals
    this.rewindBuffer = new RewindBuffer({
      id: `master__${this.id}`,
      streamKey: this.id,
      maxSeconds: this.config.rewind.bufferSeconds,
      //initialBurst: this.config.rewind.bufferSeconds,
      logger: this.logger
    });

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

    this.sources.on("vitals", this.updateVitals);
  }

  updateVitals = (vitals: SourceVitals) => {
    this.vitals = vitals;
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

  status() {
    return {
      // id is DEPRECATED in favor of key
      key: this.id,
      id: this.id,
      //vitals: this._vitals,
      //source: this.source.status(),
      //rewind: this.rewindBuffer.getStatus()
    };
  }

  getRewind(): Promise<Readable> {
    return new Promise((resolve, reject) => {
      return this.rewindBuffer.dumpBuffer((err: Error | null, _rewind: Readable) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(_rewind);
      });
    });
  }

  destroy() {
    // shut down our sources and go away
    //this.destroying = true;

    this.rewindBuffer.disconnect();
    //this.source.removeListener("data", this.dataFunc);
    //this.source.removeListener("vitals", this.vitalsFunc);

    //this.emit("destroy");
  }
}
