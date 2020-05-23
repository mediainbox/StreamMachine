var MemoryStore, bs, debug;

bs = require('binary-search');

debug = require("debug")("sm:rewind:memory_store");

module.exports = MemoryStore = class MemoryStore extends require("./base_store") {
  constructor(max_length = null) {
    super();
    this.max_length = max_length;
    this.buffer = [];
  }

  reset(cb) {
    this.buffer = [];
    return typeof cb === "function" ? cb(null) : void 0;
  }

  length() {
    return this.buffer.length;
  }

  _findTimestampOffset(ts) {
    var a, b, da, db, foffset, ref;
    foffset = bs(this.buffer, {
      ts: ts
    }, function(a, b) {
      return Number(a.ts) - Number(b.ts);
    });
    if (foffset >= 0) {
      // if exact, return right away
      return this.buffer.length - 1 - foffset;
    } else if (foffset === -1) {
      // our timestamp would be the first one in the buffer. Return
      // whatever is there, regardless of how close
      return this.buffer.length - 1;
    } else {
      foffset = Math.abs(foffset) - 1;
      // Look at this index, and the buffer before it, to see which is
      // more appropriate
      a = this.buffer[foffset - 1];
      b = this.buffer[foffset];
      if ((Number(a.ts) <= (ref = Number(ts)) && ref < Number(a.ts) + a.duration)) {
        // it's within a
        return this.buffer.length - foffset;
      } else {
        // is it closer to the end of a, or the beginning of b?
        da = Math.abs(Number(a.ts) + a.duration - ts);
        db = Math.abs(b.ts - ts);
        if (da > db) {
          return this.buffer.length - foffset - 1;
        } else {
          return this.buffer.length - foffset;
        }
      }
    }
  }

  at(offset) {
    if (offset instanceof Date) {
      offset = this._findTimestampOffset(offset);
      if (offset === -1) {
        return null;
      }
    } else {
      if (offset > this.buffer.length) {
        offset = this.buffer.length - 1;
      }
      if (offset < 0) {
        offset = 0;
      }
    }

    return this.buffer[this.buffer.length - 1 - offset];
  }

  range(offset, length, cb) {
    var end, start;
    if (offset instanceof Date) {
      offset = this._findTimestampOffset(offset);
      if (offset === -1) {
        return cb(new Error("Timestamp not found in RewindBuffer"));
      }
    } else {
      if (offset > this.buffer.length) {
        offset = this.buffer.length - 1;
      }
      if (offset < 0) {
        offset = 0;
      }
    }
    if (length > offset) {
      length = offset;
    }
    start = this.buffer.length - offset;
    end = start + length;
    return cb(null, this.buffer.slice(start, end));
  }

  first() {
    return this.buffer[0];
  }

  last() {
    return this.buffer[this.buffer.length - 1];
  }

  clone(cb) {
    var buf_copy;
    buf_copy = this.buffer.slice(0);
    return cb(null, buf_copy);
  }

  insert(chunk) {
    var cts, fb, lb;
    fb = this.buffer[0];
    lb = this.buffer[this.buffer.length - 1];
    if (fb) {
      fb = Number(fb.ts);
    }
    if (lb) {
      lb = Number(lb.ts);
    }
    cts = Number(chunk.ts);
    if (!lb || cts > lb) {
      // append
      this.buffer.push(chunk);
      this.emit("push", chunk);
    // If the current chunk's timestamp is lower than the first one's, i
    // insert it at the beginning of the array
    } else if (cts < fb) {
      // prepend
      this.buffer.unshift(chunk);
      this.emit("unshift", chunk);
    // If the current chunk's timestamp matches the last chunk's,
    // it's probable that insert() was called again using the same chunk
    // Often related to dangling event handlers that were not properly removed
    } else if (cts === fb || cts === lb || this.buffer.find(b => b.ts.valueOf() === cts)) {
      //debug(`Chunk timestamp already found in the buffer! [cts: ${cts}, fb: ${fb}, lb: ${lb}]`);
    } else {
      // need to insert in the middle.
      debug(`Push in the middle not implemented! [cts: ${cts}, fb: ${fb}, lb: ${lb}]`);
    }
    this._truncate();
    return true;
  }

  _truncate() {
    var b, results;
    results = [];
    // -- should we remove? -- #
    while (this.max_length && this.buffer.length > this.max_length) {
      b = this.buffer.shift();
      results.push(this.emit("shift", b));
    }
    return results;
  }

  info() {}
};
