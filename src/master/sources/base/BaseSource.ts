import uuid from "uuid";
import {FrameChunker} from "./FrameChunker";
import {Milliseconds, Seconds} from "../../../types/util";
import {Logger} from "winston";
import {getParserForFormat} from "../../../parsers/parserFactory";
import {FrameHeader} from "../../../parsers/types";
import { EventEmitter } from 'events';
import {ISource} from "./ISource";
import {Format, SourceStatus, SourceVitals} from "../../../types";
import { Writable } from "stream";

export interface SourceConfig {
  readonly format: Format;
  readonly chunkDuration: Seconds;
  readonly priority: number;
}

export abstract class BaseSource extends EventEmitter implements ISource {
  protected readonly id = uuid.v4();
  protected connected = false;
  protected connectedAt: Date | null = null;
  protected vitals: SourceVitals | null;

  protected chunker: FrameChunker;
  protected parser: Writable;

  protected constructor(
    protected readonly config: SourceConfig,
    protected readonly logger: Logger
  ) {
    super();

    this.createParser();
  }

  abstract getType(): string;
  abstract connect(): void;
  abstract getStatus(): SourceStatus;

  createParser() {
    // turns data frames into chunks
    this.chunker = new FrameChunker(this.config.chunkDuration * 1000);
    this.parser = getParserForFormat(this.config.format);

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
        this.emit("_chunk", chunk)
      }
    });
  }

  private setVitals(vitals: SourceVitals) {
    this.logger.info(`set source vitals ${vitals.streamKey}`, { vitals })
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
