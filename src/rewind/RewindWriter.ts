import {Readable} from "stream";
import {Chunk, SourceVitals} from "../types";
import _ from "lodash";

const Concentrate = require("concentrate");

export class RewindWriter extends Readable {
  private concentrate = Concentrate();
  private index: number;

  constructor(
    private readonly buffer: Chunk[],
    private readonly vitals: SourceVitals,
  ) {
    super({
      highWaterMark: 25 * 1024 * 1024
    });

    this.index = this.buffer.length - 1;

    // make sure there's something to send
    if (this.buffer.length === 0) {
      this.push(null);
    } else {
      this.writeHeader();
    }
  }

  private writeHeader() {
    const lastChunk = this.buffer[this.buffer.length - 1];

    const dumpHeader = Buffer.from(JSON.stringify({
      __header__: true,
      startTs: this.buffer[0].ts,
      endTs: lastChunk.ts + lastChunk.duration,
      vitals: this.vitals,
    }));

    // header buffer length
    this.concentrate.uint32le(dumpHeader.length);

    // header buffer json
    this.concentrate.buffer(dumpHeader);

    this.push(this.concentrate.result());
    this.concentrate.reset();
  }

  _read(size: number) {
    let chunk, chunkMetadata, res, result, wlen;

    if (this.index < 0) {
      return false;
    }

    // read chunks
    wlen = 0;
    while (true) {
      chunk = this.buffer[this.index];
      chunkMetadata = Buffer.from(JSON.stringify(_.omit(chunk, 'data')));

      // 1) metadata length
      this.concentrate.uint8(chunkMetadata.length);

      // 2) metadata json
      this.concentrate.buffer(chunkMetadata);

      // 3) data chunk length
      this.concentrate.uint16le(chunk.data.length);

      // 4) data chunk
      this.concentrate.buffer(chunk.data);

      res = this.concentrate.result();
      this.concentrate.reset();
      result = this.push(res);

      wlen += res.length;
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
