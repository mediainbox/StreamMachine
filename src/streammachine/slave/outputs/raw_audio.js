const BaseHttpOutput = require("./base_http_output");

module.exports = class RawAudio extends BaseHttpOutput {
  type = "raw";
  pump = true;

  constructor({ stream, req, res, ctx }) {
    super({
      stream,
      req,
      res,
      ctx
    });

    this.logger.debug('handle new listener');

    this.client.offsetSecs = req.query.offset || 0;
    this.init();

    return this.stream.startSession(this.client, (err, session_id) => {
      this.client.session_id = session_id;
      return this.connectToStream();
    });
  }

  getType() {
    return "raw";
  }

  static canHandleRequest() {
    return true;
  }

  configureResponse(baseHeaders) {
    this.res.chunkedEncoding = false;
    this.res.useChunkedEncodingByDefault = false;
    this.res.writeHead(200, baseHeaders);
    this.res._send('');
  }

  connectToStream() {
    if (this.disconnected) {
      this.logger.warn('');
      return;
    }

    this.logger.debug('connect new listener');

    /**
     * this.stream.connectListener(this.socket)
     */

    return this.stream.listen(this, {
      offsetSecs: this.client.offsetSecs,
      offset: this.client.offset,
      pump: this.pump,
      startTime: new Date()
    }, (err, source) => {
      var ref;
      this.source = source;
      if (err) {
        if (this.res != null) {
          this.res.status(500).end(err);
        } else {
          if ((ref = this.socket) != null) {
            ref.end();
          }
        }
        return false;
      }
      // update our offset now that it's been checked for availability
      this.client.offset = this.source.offset();

      return this.source.pipe(this.socket);
    });
  }

  disconnect() {
    return super.disconnect(() => {
      var ref, ref1;
      if ((ref = this.source) != null) {
        ref.disconnect();
      }
      if (!this.socket.destroyed) {
        return (ref1 = this.socket) != null ? ref1.end() : void 0;
      }
    });
  }
};
