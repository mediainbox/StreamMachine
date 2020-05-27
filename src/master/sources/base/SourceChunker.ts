import {BaseTypedEmitter} from "../../../helpers/events";
import {FrameChunker} from "./FrameChunker";
import {getParserForFormat} from "../../../parsers/parserFactory";
import {Writable} from "stream";
import {Chunk, Format, SourceVitals} from "../../../types";
import {Seconds} from "../../../types/util";
import {FrameHeader} from "../../../parsers/types";

interface Events {
  vitals: (vitals: SourceVitals) => void;
  chunk: (chunk: Chunk) => void;
}

interface Config {
  readonly chunkDuration: Seconds;
  readonly format: Format;
}

export class SourceChunker extends Writable implements BaseTypedEmitter<Events> {
  protected chunker?: FrameChunker;
  protected parser?: Writable;

  constructor(private readonly config: Config) {
    super();


    this.prepare();
  }

  prepare() {
    this.reset();

    this.chunker = new FrameChunker(this.config.chunkDuration * 1000);
    this.parser = getParserForFormat(this.config.format);

    this.chunker.resetTime(Date.now());

    // get vitals from first header
    this.parser.once("header", (header: FrameHeader) => {
      this.emit("vitals", {
        streamKey: header.stream_key,
        framesPerSecond: header.frames_per_sec,
        chunkDuration: this.config.chunkDuration
      });
    });

    // pass frames to chunker
    this.parser.on("frame", (frame: Buffer, header: FrameHeader) => {
      this.chunker!.write({
        frame: frame,
        header: header
      });
    });

    // get chunks from chunker
    this.chunker.on("readable", () => {
      let chunk;

      while (chunk = this.chunker!.read()) {
        this.emit("chunk", chunk)
      }
    });
  }

  reset() {
    this.chunker?.destroy();
    this.chunker?.removeAllListeners();

    this.parser?.destroy();
    this.parser?.removeAllListeners();
  }

  _destroy() {
    this.reset();
  }
}
