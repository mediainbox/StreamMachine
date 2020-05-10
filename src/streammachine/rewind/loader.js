const { Transform  } = require('stream');

function buildParser() {
  return Dissolve().uint32le("header_length").tap(function () {
    this.buffer("header", this.vars.header_length).tap(function () {
      this.push(JSON.parse(this.vars.header));
      this.vars = {};
      this.loop(function (end) {
        this.uint8("meta_length").tap(function () {
          this.buffer("meta", this.vars.meta_length).uint16le("data_length").tap(function () {
            this.buffer("data", this.vars.data_length).tap(function () {
              var meta;
              meta = JSON.parse(this.vars.meta.toString());
              this.push({
                ts: new Date(meta.ts),
                meta: meta.meta,
                duration: meta.duration,
                data: this.vars.data
              });
              this.vars = {};
            });
          });
        });
      });
    });
  })
}


module.exports = class RewindLoader extends Transform {
  constructor(opts) {
    super(opts);

    this.parser = buildParser();
  }

  transform(chunk, encoding, callback) {
    this.push(chunk.toString().toUpperCase());
    callback();
  }
};

module.exports = RewindLoader;

  module.exports = class RewindLoader extends Transform {
  loadBuffer(stream, cb) {
    var headerRead, parser;
    this.loading = true;
    this.emit("rewind_loading");
    if (!stream) {
      // Calling loadBuffer with no stream is really just for testing
      process.nextTick(() => {
        this.emit("rewind_loaded");
        return this.loading = false;
      });
      return cb(null, {
        seconds: 0,
        length: 0
      });
    }
    stream.pipe(parser);
    headerRead = false;
    parser.on("readable", () => {
      var c, results;
      results = [];
      while (c = parser.read()) {
        if (!headerRead) {
          headerRead = true;
          this.emit("header", c);
          this._rChunkLength({
            emitDuration: c.secs_per_chunk,
            streamKey: c.stream_key
          });
        } else {
          this._insertBuffer(c);
          this.emit("buffer", c);
        }
        results.push(true);
      }
      return results;
    });
    return parser.on("end", () => {
      var obj;
      obj = {
        seconds: this.bufferedSecs(),
        length: this.buffer.length()
      };
      this.logger.info(`rewind buffer received has ${obj.seconds} seconds (${obj.length} chunks)`);
      this.emit("rewind_loaded");
      this.loading = false;
      return typeof cb === "function" ? cb(null, obj) : void 0;
    });
  }
};
