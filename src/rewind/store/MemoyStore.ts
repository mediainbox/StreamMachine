import {IChunkStore} from "./IChunkStore";
import bs from 'binary-search';
import {Chunk} from "../../types";
import {TypedEmitterClass} from "../../helpers/events";

interface Events {
  push: (chunk: Chunk) => void;
  shift: (chunk: Chunk) => void;
  unshift: (chunk: Chunk) => void;
}

export class MemoryStore extends TypedEmitterClass<Events>() implements IChunkStore {
  private buffer: Chunk[];

  constructor(private maxLength = 0) {
    super();
    this.maxLength = maxLength;
    this.buffer = [];
  }

  length() {
    return this.buffer.length;
  }

  setMaxLength(len: number) {
    this.maxLength = len;
    this.truncate();
  }

  reset() {
    this.buffer = [];
  }

  private truncate() {
    while (this.maxLength && this.buffer.length > this.maxLength) {
      const chunk = this.buffer.shift();
      chunk && this.emit("shift", chunk);
    }
  }

  private findTimestampOffset(ts: number): number {
    let foffset = bs(this.buffer, {
      ts: ts
    }, function (a, b) {
      return Number(a.ts) - Number(b.ts);
    });

    if (foffset >= 0) {
      // if exact, return right away
      return this.buffer.length - 1 - foffset;
    } else if (foffset === -1) {
      // our timestamp would be the first one in the buffer. Return
      // whatever is there, regardless of how close
      return this.buffer.length - 1;
    }

    foffset = Math.abs(foffset) - 1;
    // Look at this index, and the buffer before it, to see which is
    // more appropriate
    const a = this.buffer[foffset - 1];
    const b = this.buffer[foffset];

    if (Number(a.ts) <= ts && ts < Number(a.ts) + a.duration) {
      // it's within a
      return this.buffer.length - foffset;
    }

    // is it closer to the end of a, or the beginning of b?
    const da = Math.abs(Number(a.ts) + a.duration - ts);
    const db = Math.abs(b.ts - ts);

    if (da > db) {
      return this.buffer.length - foffset - 1;
    } else {
      return this.buffer.length - foffset;
    }
  }

  at(offset: number | Date): Chunk | null {
    if (offset instanceof Date) {
      offset = this.findTimestampOffset(offset.valueOf());

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

  range(offset: number | Date, length: number): Chunk[] {
    var end, start;
    if (offset instanceof Date) {
      offset = this.findTimestampOffset(offset.valueOf());
      if (offset === -1) {
        return [];
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

    return this.buffer.slice(start, end);
  }

  first() {
    return this.buffer[0];
  }

  last() {
    return this.buffer[this.buffer.length - 1];
  }

  clone() {
    return this.buffer.slice(0);
  }

  insert(chunk: Chunk) {
    if (!this.buffer.length) {
      this.buffer.push(chunk);
      return;
    }

    const fb = this.buffer[0].ts;
    const lb = this.buffer[this.buffer.length - 1].ts;
    const cts = Number(chunk.ts);

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
      // Chunk timestamp already found in the buffer
    } else {
      // need to insert in the middle.
      // Push in the middle not implemented! [cts: ${cts}, fb: ${fb}, lb: ${lb}]
    }

    this.truncate();
  }
}
