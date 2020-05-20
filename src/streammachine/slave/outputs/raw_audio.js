const BaseHttpOutput = require("./base_http_output");

module.exports = class RawAudio extends BaseHttpOutput {
  type = "raw";
  pump = true;

  isStreaming = false;

  static canHandleRequest() {
    return true;
  }

  getType() {
    return "raw";
  }

  configure(baseHeaders) {
    this.disconnected = false;
    this.res.chunkedEncoding = false;
    this.res.useChunkedEncodingByDefault = false;
    this.res.writeHead(200, baseHeaders);
    this.res._send('');
  }

  getQueuedBytes() {
    if (!this.isStreaming) {
      return false;
    }

    const bufferSize = this.socket.bufferSize || 0;
    const queuedBytes = this.source._queuedBytes || 0;

    return bufferSize + queuedBytes;
  }

  // TODO: move to BaseHttpOutput?
  sendFrom(source) {
    if (this.disconnected) {
      this.logger.warn('sendFrom() was called after disconnect');
      return;
    }

    this.isStreaming = true;
    this.source = source; // stream is Rewinder object
    source.pipe(this.socket);
  }
};
