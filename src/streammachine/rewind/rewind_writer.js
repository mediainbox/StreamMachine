const _ = require("lodash");
const Concentrate = require("concentrate");
const { Readable } = require("stream");

module.exports = class RewindWriter extends Readable {
  constructor(buf, secs1, streamKey, hls1) {
    super({
      highWaterMark: 25 * 1024 * 1024
    });
    this.buf = buf;
    this.secs = secs1;
    this.streamKey = streamKey;
    this.hls = hls1;
    this.c = Concentrate();
    this.slices = 0;
    this.i = this.buf.length - 1;
    this._ended = false;
    // make sure there's something to send
    if (this.buf.length === 0) {
      this.push(null);
    } else {
      this._writeHeader();
    }
  }

  //----------
  _writeHeader(cb) {
    var header_buf;
    // -- Write header -- #
    header_buf = Buffer.from(JSON.stringify({
      start_ts: this.buf[0].ts,
      end_ts: this.buf[this.buf.length - 1].ts,
      secs_per_chunk: this.secs,
      stream_key: this.streamKey,
      hls: this.hls
    }));
    // header buffer length
    this.c.uint32le(header_buf.length);
    // header buffer json
    this.c.buffer(header_buf);
    this.push(this.c.result());
    return this.c.reset();
  }

  //----------
  _read(size) {
    var chunk, meta_buf, r, result, wlen;
    if (this.i < 0) {
      return false;
    }
    // -- Data Chunks -- #
    wlen = 0;
    while (true) {
      chunk = this.buf[this.i];
      meta_buf = Buffer.from(JSON.stringify({
        ts: chunk.ts,
        meta: chunk.meta,
        duration: chunk.duration
      }));
      // 1) metadata length
      this.c.uint8(meta_buf.length);
      // 2) metadata json
      this.c.buffer(meta_buf);
      // 3) data chunk length
      this.c.uint16le(chunk.data.length);
      // 4) data chunk
      this.c.buffer(chunk.data);
      r = this.c.result();
      this.c.reset();
      result = this.push(r);
      wlen += r.length;
      this.i -= 1;
      if (this.i < 0) {
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
