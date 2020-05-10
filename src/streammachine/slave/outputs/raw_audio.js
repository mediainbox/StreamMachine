const BaseHttpOutput = require("./base_http_output");

module.exports = class RawAudio extends BaseHttpOutput {
  type = "raw";
  pump = true;

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
    const bufferSize = this.socket.bufferSize || 0;
    const queuedBytes = this.source._queuedBytes || 0;

    return bufferSize + queuedBytes;
  }

  // move to base?
  send(source, preroll = null) {
    if (this.disconnected) {
      this.logger.warn('called ready after disconnect');
      return;
    }

    this.source = source; // stream is Rewinder object
    source.pipe(this.socket);
  }
};
