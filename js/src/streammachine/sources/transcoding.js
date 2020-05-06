var Debounce, FFmpeg, PassThrough, TranscodingSource, _, debug;

_ = require("underscore");

FFmpeg = require("fluent-ffmpeg");

PassThrough = require("stream").PassThrough;

Debounce = require("../util/debounce");

debug = require("debug")("sm:sources:transcoding");

module.exports = TranscodingSource = class TranscodingSource extends require("./base") {
  TYPE() {
    return `Transcoding (${this.connected ? "Connected" : "Waiting"})`;
  }

  constructor(opts) {
    super({
      skipParser: true
    });
    this.opts = opts;
    this._disconnected = false;
    this.d = require("domain").create();
    this.d.on("error", (err) => {
      var ref;
      if ((ref = this.log) != null) {
        ref.error("TranscodingSource domain error:" + err);
      }
      debug(`Domain error: ${err}`, err);
      return this.disconnect();
    });
    this.d.run(() => {
      this._queue = [];
      this.o_stream = this.opts.stream;
      this.last_ts = null;
      // we start up an ffmpeg transcoder and then listen for data events
      // from our source. Each time we get a chunk of audio data, we feed
      // it into ffmpeg.  We then run the stream of transcoded data that
      // comes back through our parser to re-chunk it. We count chunks to
      // attach the right timing information to the chunks that come out
      this._buf = new PassThrough();
      this.ffmpeg = new FFmpeg({
        source: this._buf,
        captureStderr: false
      }).addOptions(this.opts.ffmpeg_args.split("|"));
      this.ffmpeg.on("start", (cmd) => {
        var ref;
        return (ref = this.log) != null ? ref.info(`ffmpeg started with ${cmd}`) : void 0;
      });
      this.ffmpeg.on("error", (err, stdout, stderr) => {
        var ref, ref1, ref2, ref3;
        if (err.code === "ENOENT") {
          if ((ref = this.log) != null) {
            ref.error("ffmpeg failed to start.");
          }
          return this.disconnect();
        } else {
          if ((ref1 = this.log) != null) {
            ref1.error(`ffmpeg transcoding error: ${err}`);
          }
          if ((ref2 = this.log) != null) {
            ref2.error(`ffmpeg transcoding error stdout: ${stdout}`);
          }
          if ((ref3 = this.log) != null) {
            ref3.error(`ffmpeg transcoding error stderr: ${stderr}`);
          }
          return this.disconnect();
        }
      });
      this.ffmpeg.writeToStream(this.parser);
      // -- watch for discontinuities -- #
      this._pingData = new Debounce(this.opts.discontinuityTimeout || 30 * 1000, (last_ts) => {
        var ref;
        // data has stopped flowing. mark a discontinuity in the chunker.
        if ((ref = this.log) != null) {
          ref.info("Transcoder data interupted. Marking discontinuity.");
        }
        this.emit("discontinuity_begin", last_ts);
        return this.o_stream.once("data", (chunk) => {
          var ref1;
          if ((ref1 = this.log) != null) {
            ref1.info(`Transcoder data resumed. Reseting time to ${chunk.ts}.`);
          }
          this.emit("discontinuity_end", chunk.ts, last_ts);
          return this.chunker.resetTime(chunk.ts);
        });
      });
      // -- chunking -- #
      this.oDataFunc = (chunk) => {
        this._pingData.ping();
        return this._buf.write(chunk.data);
      };
      this.oFirstDataFunc = (first_chunk) => {
        this.emit("connected");
        this.connected = true;
        this.oFirstDataFunc = null;
        this.chunker = new TranscodingSource.FrameChunker(this.emitDuration * 1000, first_chunk.ts);
        this.parser.on("frame", (frame, header) => {
          // we need to re-apply our chunking logic to the output
          return this.chunker.write({
            frame: frame,
            header: header
          });
        });
        this.chunker.on("readable", () => {
          var c, results;
          results = [];
          while (c = this.chunker.read()) {
            this.last_ts = c.ts;
            results.push(this.emit("data", c));
          }
          return results;
        });
        this.o_stream.on("data", this.oDataFunc);
        return this._buf.write(first_chunk.data);
      };
      this.o_stream.once("data", this.oFirstDataFunc);
      // -- watch for vitals -- #
      return this.parser.once("header", (header) => {
        var ref, ref1;
        // -- compute frames per second and stream key -- #
        this.framesPerSec = header.frames_per_sec;
        this.streamKey = header.stream_key;
        if ((ref = this.log) != null) {
          ref.debug("setting framesPerSec to ", {
            frames: this.framesPerSec
          });
        }
        if ((ref1 = this.log) != null) {
          ref1.debug("first header is ", header);
        }
        // -- send out our stream vitals -- #
        return this._setVitals({
          streamKey: this.streamKey,
          framesPerSec: this.framesPerSec,
          emitDuration: this.emitDuration
        });
      });
    });
  }

  //----------
  status() {
    var ref;
    return {
      source: (ref = typeof this.TYPE === "function" ? this.TYPE() : void 0) != null ? ref : this.TYPE,
      connected: this.connected,
      url: "N/A",
      streamKey: this.streamKey,
      uuid: this.uuid,
      last_ts: this.last_ts
    };
  }

  //----------
  disconnect() {
    if (!this._disconnected) {
      this._disconnected = true;
      this.d.run(() => {
        var ref;
        this.o_stream.removeListener("data", this.oDataFunc);
        if (this.oFirstDataFunc) {
          this.o_stream.removeListener("data", this.oFirstDataFunc);
        }
        this.ffmpeg.kill();
        if ((ref = this._pingData) != null) {
          ref.kill();
        }
        return this.connected = false;
      });
      this.emit("disconnect");
      return this.removeAllListeners();
    }
  }

};

//# sourceMappingURL=transcoding.js.map
