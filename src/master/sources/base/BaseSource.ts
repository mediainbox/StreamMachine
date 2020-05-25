import * as uuid from "uuid";
import {FrameChunker} from "./FrameChunker";
import {Logger} from "winston";
import {getParserForFormat} from "../../../parsers/parserFactory";
import {FrameHeader} from "../../../parsers/types";
import {ISource, SourceConfig, SourceEvents} from "./ISource";
import {SourceStatus, SourceVitals} from "../../../types";
import {Writable} from "stream";
import {componentLogger} from "../../../logger";
import {TypedEmitterClass} from "../../../helpers/events";

export abstract class BaseSource extends TypedEmitterClass<SourceEvents>() implements ISource {
  protected readonly id = uuid.v4();
  protected connected = false;
  protected connectedAt: Date | null = null;
  protected vitals: SourceVitals | null = null;

  protected chunker: FrameChunker;
  protected parser: Writable;

  protected readonly logger: Logger

  protected constructor(
    protected readonly config: SourceConfig,
  ) {
    super();

    this.logger = componentLogger(`source_${this.config.type}`);

    this.chunker = new FrameChunker(this.config.chunkDuration * 1000);

    // turns data frames into chunks
    this.parser = getParserForFormat(this.config.format);

    this.setupParser();
  }

  abstract connect(): void;
  abstract getStatus(): SourceStatus;

  getType() {
    return this.config.type;
  }

  // TODO: refactor externally
  setupParser() {
    // get vitals from first header
    this.parser.once("header", (header: FrameHeader) => {
      this.setVitals({
        streamKey: header.stream_key,
        framesPerSecond: header.frames_per_sec,
        chunkDuration: this.config.chunkDuration
      });
    });

    // pass frames to chunker
    this.parser.on("frame", (frame: Buffer, header: FrameHeader) => {
      return this.chunker.write({
        frame: frame,
        header: header
      });
    });

    // get chunks from chunker
    this.chunker.on("readable", () => {
      let chunk;

      while (chunk = this.chunker.read()) {
        this.emit("chunk", chunk)
      }
    });
  }

  private setVitals(vitals: SourceVitals) {
    this.logger.info(`set source vitals ${vitals.streamKey}`, {vitals})
    this.vitals = vitals;
    this.emit("vitals", this.vitals);
  }

  getVitals(): Promise<SourceVitals> {
    return new Promise(resolve => {
      if (this.vitals) {
        return this.vitals;
      }

      return this.once('vitals', resolve);
    });
  }

  disconnect() {
    this.logger.info('source disconnected');
    this.connected = false;

    this.chunker?.removeAllListeners();
    this.parser?.removeAllListeners();
  }
}
