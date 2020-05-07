var StreamGroup;

module.exports = StreamGroup = class StreamGroup extends require("events").EventEmitter {
  constructor(key, logger) {
    super();
    this.key = key;
    this.logger = logger;
    this.streams = {};
    this.transcoders = {};
    this.hls_min_id = null;
  }

  //----------
  addStream(stream) {
    var delFunc, ref;
    if (!this.streams[stream.key]) {
      this.logger.debug(`SG ${this.key}: Adding stream ${stream.key}`);
      this.streams[stream.key] = stream;
      // listen in case it goes away
      delFunc = () => {
        this.logger.debug(`SG ${this.key}: Stream disconnected: ${stream.key}`);
        return delete this.streams[stream.key];
      };
      stream.on("disconnect", delFunc);
      stream.on("config", () => {
        if (stream.opts.group !== this.key) {
          return delFunc();
        }
      });
      // if HLS is enabled, sync the stream to the rest of the group
      return (ref = stream.rewind.hls_segmenter) != null ? ref.syncToGroup(this) : void 0;
    }
  }

  //----------
  status() {
    var k, ref, s, sstatus;
    sstatus = {};
    ref = this.streams;
    for (k in ref) {
      s = ref[k];
      sstatus[k] = s.status();
    }
    return {
      id: this.key,
      streams: sstatus
    };
  }

};

//----------

//# sourceMappingURL=stream_group.js.map
