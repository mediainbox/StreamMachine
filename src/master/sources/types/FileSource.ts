// @ts-nocheck

// FileSource emulates a stream source by reading a local audio file in a
// loop at the correct audio speed.
import {BaseSource} from "./base/BaseSource";

export class FileSource extends BaseSource {
  TYPE() {
    return `File (${this.opts.filePath})`;
  }

  constructor(opts) {
    super();
    this.opts = opts;
    this.connected = false;
    this._file = null;
    this._chunks = [];
    this._emit_pos = 0;
    this._last_ts = Number(this.opts.ts) || null;
    if (!this.opts.do_not_emit) {
      this.start();
    }
    this.on("_chunk", (chunk) => {
      return this._chunks.push(chunk);
    });
    this.createParser();
    this.parser.once("header", (header) => {
      this.connected = true;
      return this.emit("connect");
    });
    this.parser.once("end", () => {
      // done parsing...
      this.parser.removeAllListeners();
      this._current_chunk = null;
      return this.emit("_loaded");
    });
    // pipe our file into the parser
    this._file = fs.createReadStream(this.opts.filePath);
    this._file.pipe(this.parser);
  }

  //----------
  start() {
    if (this._int) {
      return true;
    }
    this._int = setInterval(() => {
      return this._emitOnce();
    }, this.emitDuration * 1000);
    this._emitOnce();
    return true;
  }

  //----------
  stop() {
    if (!this._int) {
      return true;
    }
    clearInterval(this._int);
    this._int = null;
    return true;
  }

  //----------

    // emit a certain length of time. useful for filling a buffer
  emitSeconds(secs, wait, cb) {
    var _f, count, emits;
    if (_.isFunction(wait)) {
      cb = wait;
      wait = null;
    }
    emits = Math.ceil(secs / this.emitDuration);
    count = 0;
    if (wait) {
      _f = () => {
        this._emitOnce();
        count += 1;
        if (count < emits) {
          return setTimeout(_f, wait);
        } else {
          return cb();
        }
      };
      return _f();
    } else {
      _f = () => {
        this._emitOnce();
        count += 1;
        if (count < emits) {
          return process.nextTick(() => {
            return _f();
          });
        } else {
          return cb();
        }
      };
      return _f();
    }
  }

  //----------
  _emitOnce(ts = null) {
    var chunk;
    if (this._emit_pos >= this._chunks.length) {
      this._emit_pos = 0;
    }
    chunk = this._chunks[this._emit_pos];
    if (!chunk) {
      return;
    }
    if (!chunk.data) {
      console.log("NO DATA!!!! ", chunk);
    }
    ts = this._last_ts ? this._last_ts + chunk.duration : Number(new Date());
    this.emit("data", {
      data: chunk.data,
      ts: new Date(ts),
      duration: chunk.duration,
      streamKey: this.streamKey,
      uuid: this.uuid
    });
    this._last_ts = ts;
    return this._emit_pos = this._emit_pos + 1;
  }

  //----------
  status() {
    var ref;
    return {
      source: (ref = typeof this.TYPE === "function" ? this.TYPE() : void 0) != null ? ref : this.TYPE,
      uuid: this.uuid,
      filePath: this.filePath
    };
  }

  //----------
  disconnect() {
    if (this.connected) {
      this.connected = false;
      this.emit("disconnect");
      return clearInterval(this._int);
    }
  }

};
