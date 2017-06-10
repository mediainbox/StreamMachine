var MemoryStore, bs, debug,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

bs = require('binary-search');

debug = require("debug")("sm:rewind:memory_store");

module.exports = MemoryStore = (function(_super) {
  __extends(MemoryStore, _super);

  function MemoryStore(max_length) {
    this.max_length = max_length != null ? max_length : null;
    this.buffer = [];
  }

  MemoryStore.prototype.reset = function(cb) {
    this.buffer = [];
    return typeof cb === "function" ? cb(null) : void 0;
  };

  MemoryStore.prototype.length = function() {
    return this.buffer.length;
  };

  MemoryStore.prototype._findTimestampOffset = function(ts) {
    var a, b, da, db, foffset, _ref;
    foffset = bs(this.buffer, {
      ts: ts
    }, function(a, b) {
      return Number(a.ts) - Number(b.ts);
    });
    if (foffset >= 0) {
      return this.buffer.length - 1 - foffset;
    } else if (foffset === -1) {
      return this.buffer.length - 1;
    } else {
      foffset = Math.abs(foffset) - 1;
      a = this.buffer[foffset - 1];
      b = this.buffer[foffset];
      if ((Number(a.ts) <= (_ref = Number(ts)) && _ref < Number(a.ts) + a.duration)) {
        return this.buffer.length - foffset;
      } else {
        da = Math.abs(Number(a.ts) + a.duration - ts);
        db = Math.abs(b.ts - ts);
        if (da > db) {
          return this.buffer.length - foffset - 1;
        } else {
          return this.buffer.length - foffset;
        }
      }
    }
  };

  MemoryStore.prototype.at = function(offset, cb) {
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
    return cb(null, this.buffer[this.buffer.length - 1 - offset]);
  };

  MemoryStore.prototype.range = function(offset, length, cb) {
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
    start = this.buffer.length - 1 - offset;
    end = start + length;
    return cb(null, this.buffer.slice(start, end));
  };

  MemoryStore.prototype.first = function() {
    return this.buffer[0];
  };

  MemoryStore.prototype.last = function() {
    return this.buffer[this.buffer.length - 1];
  };

  MemoryStore.prototype.clone = function(cb) {
    var buf_copy;
    buf_copy = this.buffer.slice(0);
    return cb(null, buf_copy);
  };

  MemoryStore.prototype.insert = function(chunk) {
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
      this.buffer.push(chunk);
      this.emit("push", chunk);
    } else if (cts < fb) {
      this.buffer.unshift(chunk);
      this.emit("unshift", chunk);
    } else {
      debug("Push in the middle not implemented " + cts + ", " + fb + ", " + lb);
      console.error("PUSH IN MIDDLE NOT IMPLEMENTED", cts, fb, lb);
    }
    this._truncate();
    return true;
  };

  MemoryStore.prototype._truncate = function() {
    var b, _results;
    _results = [];
    while (this.max_length && this.buffer.length > this.max_length) {
      b = this.buffer.shift();
      _results.push(this.emit("shift", b));
    }
    return _results;
  };

  MemoryStore.prototype.info = function() {};

  return MemoryStore;

})(require("./base_store"));

//# sourceMappingURL=memory_store.js.map
