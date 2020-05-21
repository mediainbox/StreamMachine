import {HttpOutput} from "./HttpOutput";
import { Readable } from "stream";

export class RawAudio extends HttpOutput {
  readonly TYPE = "raw";

  private pump = true;
  private isStreaming = false;

  configure(headers: any) {
    this.res.chunkedEncoding = false;
    this.res.useChunkedEncodingByDefault = false;
    this.res.writeHead(200, headers);
    this.res._send('');
  }

  getQueuedBytes() {
    if (!this.isStreaming) {
      return false;
    }

    const bufferSize = this.socket.bufferSize || 0;
    const queuedBytes = this.source.queuedBytes || 0;

    return bufferSize + queuedBytes;
  }

  // TODO: move to BaseHttpOutput?
  send(source: Readable) {
    if (this.disconnected) {
      this.logger.warn('send() was called after disconnect');
      return;
    }

    this.isStreaming = true;
    this.source = source; // usually preroll + rewinder
    source.pipe(this.socket);
  }
}
