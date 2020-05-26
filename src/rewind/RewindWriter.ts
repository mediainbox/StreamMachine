import { Readable } from "stream";
import {IChunkStore} from "./store/IChunkStore";
import {Seconds} from "../types/util";
import {Chunk} from "../types";

const Concentrate = require("concentrate");

export class RewindWriter extends Readable {
  private concentrate = Concentrate();
  private index: number;

  constructor(
    private buffer: Chunk[],
    private chunkDuration: Seconds,
    private streamKey: string,
  ) {
    super({
      highWaterMark: 25 * 1024 * 1024
    });

    this.streamKey = streamKey;

    this.index = this.buffer.length - 1;

    // make sure there's something to send
    if (this.buffer.length === 0) {
      this.push(null);
    } else {
      this.writeHeader();
    }
  }

  private writeHeader() {
    // -- Write header -- #
    const header_buf = Buffer.from(JSON.stringify({
      start_ts: this.buffer[0].ts,
      end_ts: this.buffer[this.buffer.length - 1].ts,
      secs_per_chunk: this.chunkDuration,
      stream_key: this.streamKey,
    }));

    // header buffer length
    this.concentrate.uint32le(header_buf.length);

    // header buffer json
    this.concentrate.buffer(header_buf);

    this.push(this.concentrate.result());
    this.concentrate.reset();
  }

  _read(size: number) {
    let chunk, meta_buf, r, result, wlen;

    if (this.index < 0) {
      return false;
    }

    // -- Data Chunks -- #
    wlen = 0;
    while (true) {
      chunk = this.buffer[this.index];
      meta_buf = Buffer.from(JSON.stringify({
        ts: chunk.ts,
        duration: chunk.duration,
        frames: chunk.frames,
        streamKey: chunk.streamKey,
      }));

      // 1) metadata length
      this.concentrate.uint8(meta_buf.length);

      // 2) metadata json
      this.concentrate.buffer(meta_buf);

      // 3) data chunk length
      this.concentrate.uint16le(chunk.data.length);

      // 4) data chunk
      this.concentrate.buffer(chunk.data);

      r = this.concentrate.result();
      this.concentrate.reset();
      result = this.push(r);

      wlen += r.length;
      this.index -= 1;

      if (this.index < 0) {
        // finished
        this.push(null);
        return true;
      }

      if (!result || wlen > size) {
        return false;
      }
    }
  }
}
