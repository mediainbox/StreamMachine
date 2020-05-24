import { EventEmitter } from 'events';

export class IcyParser extends EventEmitter {

  static REQUEST = "REQUEST";
  static RESPONSE = "RESPONSE";

  //static prototype.reinitialize = IcyParser;
  //static prototype.requestExp = /^([A-Z]+) (.*) (ICE|HTTP)\/(1).(0|1)$/;
  //static prototype.headerExp = /^([^:]+): *(.*)$/;

  constructor(type) {
    super();
    this["INIT_" + type]();
    this.offset = 0;
  }

  execute(chunk) {
    this.chunk = chunk;
    this.offset = 0;
    this.end = this.chunk.length;
    while (this.offset < this.end) {
      this[this.state]();
      this.offset++;
    }
    return true;
  }

  INIT_REQUEST() {
    this.state = "REQUEST_LINE";
    this.lineState = "DATA";
    return this.info = {
      headers: {}
    };
  }

  consumeLine() {
    var byte, line;
    if (this.captureStart == null) {
      this.captureStart = this.offset;
    }
    byte = this.chunk[this.offset];
    if (byte === 0x0d && this.lineState === "DATA") { // \r
      this.captureEnd = this.offset;
      this.lineState = "ENDING";
      return;
    }
    if (this.lineState === "ENDING") {
      this.lineState = "DATA";
      if (byte !== 0x0a) {
        return;
      }
      line = this.chunk.toString("ascii", this.captureStart, this.captureEnd);
      this.captureStart = void 0;
      this.captureEnd = void 0;
      return line;
    }
  }

  REQUEST_LINE() {
    var line, match;
    line = this.consumeLine();
    if (line == null) {
      return;
    }
    match = this.requestExp.exec(line);
    if (match) {
      [this.info.method, this.info.url, this.info.protocol, this.info.versionMajor, this.info.versionMinor] = match.slice(1, 6);
    } else {
      // this isn't a request line that we understand... we should
      // close the connection
      this.emit("invalid");
    }
    this.info.request_offset = this.offset;
    this.info.request_line = line;
    return this.state = "HEADER";
  }

  HEADER() {
    var line, match;
    line = this.consumeLine();
    if (line == null) {
      return;
    }
    if (line) {
      match = this.headerExp.exec(line);
      return this.info.headers[match[1].toLowerCase()] = match[2];
    } else {
      return this.emit("headersComplete", this.info.headers);
    }
  }
}
