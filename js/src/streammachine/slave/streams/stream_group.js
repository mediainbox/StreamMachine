this.StreamGroup = class StreamGroup extends require("events").EventEmitter {
  constructor(key, log) {
    super();
    this.key = key;
    this.log = log;
    this.streams = {};
  }

  //----------
  addStream(stream) {
    var delFunc;
    if (!this.streams[stream.key]) {
      this.log.debug(`SG ${this.key}: Adding stream ${stream.key}`);
      this.streams[stream.key] = stream;
      // listen in case it goes away
      delFunc = () => {
        this.log.debug(`SG ${this.key}: Stream disconnected: ${stream.key}`);
        return delete this.streams[stream.key];
      };
      stream.on("disconnect", delFunc);
      return stream.on("config", () => {
        if (stream.opts.group !== this.key) {
          return delFunc();
        }
      });
    }
  }

  //----------
  startSession(client, cb) {
    this.logger.error("session_start", {
      type: "session_start",
      client: client,
      time: new Date(),
      id: client.session_id
    });
    return cb(null, client.session_id);
  }

};

//# sourceMappingURL=stream_group.js.map
