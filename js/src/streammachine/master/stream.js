var FileSource, HLSSegmenter, ProxySource, Rewind, SourceMount, Stream, TranscodingSource, URL, _, uuid;

_ = require("underscore");

uuid = require("node-uuid");

URL = require("url");

Rewind = require('../rewind_buffer');

FileSource = require("../sources/file");

ProxySource = require('../sources/proxy');

TranscodingSource = require("../sources/transcoding");

HLSSegmenter = require("../rewind/hls_segmenter");

SourceMount = require("./source_mount");

module.exports = Stream = (function() {
  class Stream extends require('events').EventEmitter {
    constructor(key, log, mount, opts) {
      var newsource, ref, uri;
      super();
      this.key = key;
      this.log = log;
      this.mount = mount;
      this.opts = _.defaults(opts || {}, this.DefaultOptions);
      // We have three options for what source we're going to use:
      // a) Internal: Create our own source mount and manage our own sources.
      //    Basically the original stream behavior.
      // b) Source Mount: Connect to a source mount and use its source
      //    directly. You'll get whatever incoming format the source gets.
      // c) Source Mount w/ Transcoding: Connect to a source mount, but run a
      //    transcoding source between it and us, so that we always get a
      //    certain format as our input.
      this.destroying = false;
      this.source = null;
      if (opts.ffmpeg_args) {
        // Source Mount w/ transcoding
        this._initTranscodingSource();
      } else {
        // Source Mount directly
        this.source = this.mount;
      }
      // Cache the last stream vitals we've seen
      this._vitals = null;
      this.emitDuration = 0;
      this.STATUS = "Initializing";
      this.log.event("Stream is initializing.");
      // -- Initialize Master Rewinder -- #

      // set up a rewind buffer, for use in bringing new slaves up to speed
      // or to transfer to a new master when restarting
      this.log.info("Initializing RewindBuffer for master stream.");
      this.rewind = new Rewind({
        seconds: this.opts.seconds,
        burst: this.opts.burst,
        key: `master__${this.key}`,
        log: this.log.child({
          module: "rewind"
        }),
        hls: (ref = this.opts.hls) != null ? ref.segment_duration : void 0
      });
      // Rewind listens to us, not to our source
      this.rewind.emit("source", this);
      // Pass along buffer loads
      this.rewind.on("buffer", (c) => {
        return this.emit("buffer", c);
      });
      // if we're doing HLS, pass along new segments
      if (this.opts.hls != null) {
        this.rewind.hls_segmenter.on("snapshot", (snap) => {
          return this.emit("hls_snapshot", snap);
        });
      }
      // -- Set up data functions -- #
      this._meta = {
        StreamTitle: this.opts.metaTitle,
        StreamUrl: ""
      };
      this.sourceMetaFunc = (meta) => {
        if (this.opts.acceptSourceMeta) {
          return this.setMetadata(meta);
        }
      };
      this.dataFunc = (data) => {
        // inject our metadata into the data object
        return this.emit("data", _.extend({}, data, {
          meta: this._meta
        }));
      };
      this.vitalsFunc = (vitals) => {
        this._vitals = vitals;
        return this.emit("vitals", vitals);
      };
      this.source.on("data", this.dataFunc);
      this.source.on("vitals", this.vitalsFunc);
      // -- Hardcoded Source -- #

      // This is an initial source like a proxy that should be connected from
      // our end, rather than waiting for an incoming connection
      if (this.opts.fallback != null) {
        // what type of a fallback is this?
        uri = URL.parse(this.opts.fallback);
        newsource = (function() {
          switch (uri.protocol) {
            case "file:":
              return new FileSource({
                format: this.opts.format,
                filePath: uri.path,
                logger: this.log
              });
            case "http:":
            case "https:":
              return new ProxySource({
                format: this.opts.format,
                url: this.opts.fallback,
                headers: this.opts.headers,
                fallback: true,
                logger: this.log
              });
            default:
              return null;
          }
        }).call(this);
        if (newsource) {
          newsource.once("connect", () => {
            return this.addSource(newsource, (err) => {
              if (err) {
                return this.log.error("Connection to fallback source failed.");
              } else {
                return this.log.event("Fallback source connected.");
              }
            });
          });
          newsource.on("error", (err) => {
            return this.log.error(`Fallback source error: ${err}`, {
              error: err
            });
          });
        } else {
          this.log.error(`Unable to determine fallback source type for ${this.opts.fallback}`);
        }
      }
    }

    //----------
    _initTranscodingSource() {
      var tsource;
      this.log.debug(`Setting up transcoding source for ${this.key}`);
      // -- create a transcoding source -- #
      tsource = new TranscodingSource({
        stream: this.mount,
        ffmpeg_args: this.opts.ffmpeg_args,
        format: this.opts.format,
        logger: this.log
      });
      this.source = tsource;
      // if our transcoder goes down, restart it
      return tsource.once("disconnect", () => {
        this.log.error(`Transcoder disconnected for ${this.key}.`);
        if (!this.destroying) {
          return process.nextTick((() => {
            return this._initTranscodingSource();
          }));
        }
      });
    }

    //----------
    addSource(source, cb) {
      return this.source.addSource(source, cb);
    }

    //----------

      // Return our configuration
    config() {
      return this.opts;
    }

    //----------
    vitals(cb) {
      var _vFunc;
      _vFunc = (v) => {
        return typeof cb === "function" ? cb(null, v) : void 0;
      };
      if (this._vitals) {
        return _vFunc(this._vitals);
      } else {
        return this.once("vitals", _vFunc);
      }
    }

    //----------
    getHLSSnapshot(cb) {
      if (this.rewind.hls_segmenter) {
        return this.rewind.hls_segmenter.snapshot(cb);
      } else {
        return cb("Stream does not support HLS");
      }
    }

    //----------
    getStreamKey(cb) {
      if (this._vitals) {
        return typeof cb === "function" ? cb(this._vitals.streamKey) : void 0;
      } else {
        return this.once("vitals", () => {
          return typeof cb === "function" ? cb(this._vitals.streamKey) : void 0;
        });
      }
    }

    //----------
    status() {
      return {
        // id is DEPRECATED in favor of key
        key: this.key,
        id: this.key,
        vitals: this._vitals,
        source: this.source.status(),
        rewind: this.rewind._rStatus()
      };
    }

    //----------
    setMetadata(opts, cb) {
      if ((opts.StreamTitle != null) || (opts.title != null)) {
        this._meta.StreamTitle = opts.StreamTitle || opts.title;
      }
      if ((opts.StreamUrl != null) || (opts.url != null)) {
        this._meta.StreamUrl = opts.StreamUrl || opts.url;
      }
      this.emit("meta", this._meta);
      return typeof cb === "function" ? cb(null, this._meta) : void 0;
    }

    //----------
    configure(new_opts, cb) {
      var k, ref, v;
      ref = this.DefaultOptions;
      // allow updates, but only to keys that are present in @DefaultOptions.
      for (k in ref) {
        v = ref[k];
        if (new_opts[k] != null) {
          this.opts[k] = new_opts[k];
        }
        if (_.isNumber(this.DefaultOptions[k])) {
          // convert to a number if necessary
          this.opts[k] = Number(this.opts[k]);
        }
      }
      if (this.key !== this.opts.key) {
        this.key = this.opts.key;
      }
      // did they update the metaTitle?
      if (new_opts.metaTitle) {
        this.setMetadata({
          title: new_opts.metaTitle
        });
      }
      // Update our rewind settings
      this.rewind.setRewind(this.opts.seconds, this.opts.burst);
      this.emit("config");
      return typeof cb === "function" ? cb(null, this.config()) : void 0;
    }

    //----------
    getRewind(cb) {
      return this.rewind.dumpBuffer((err, writer) => {
        return typeof cb === "function" ? cb(null, writer) : void 0;
      });
    }

    //----------
    destroy() {
      // shut down our sources and go away
      this.destroying = true;
      if (this.source instanceof TranscodingSource) {
        this.source.disconnect();
      }
      this.rewind.disconnect();
      this.source.removeListener("data", this.dataFunc);
      this.source.removeListener("vitals", this.vitalsFunc);
      this.dataFunc = this.vitalsFunc = this.sourceMetaFunc = function() {};
      this.emit("destroy");
      return true;
    }

  };

  Stream.prototype.DefaultOptions = {
    meta_interval: 32768,
    max_buffer: 4194304, // 4 megabits (64 seconds of 64k audio)
    key: null,
    seconds: 60 * 60 * 4, // 4 hours
    burst: 30,
    source_password: null,
    host: null,
    fallback: null,
    acceptSourceMeta: false,
    log_minutes: true,
    monitored: false,
    metaTitle: "",
    metaUrl: "",
    format: "mp3",
    preroll: "",
    preroll_key: "",
    transcoder: "",
    root_route: false,
    group: null,
    bandwidth: 0,
    codec: null,
    ffmpeg_args: null,
    stream_key: null,
    impression_delay: 5000,
    log_interval: 30000,
    geolock: null
  };

  //----------
  Stream.StreamGroup = class StreamGroup extends require("events").EventEmitter {
    constructor(key, log) {
      super();
      this.key = key;
      this.log = log;
      this.streams = {};
      this.transcoders = {};
      this.hls_min_id = null;
    }

    //----------
    addStream(stream) {
      var delFunc, ref;
      if (!this.streams[stream.key]) {
        this.log.debug(`SG ${this.key}: Adding stream ${stream.key}`);
        this.streams[stream.key] = stream;
        // listen in case it goes away
        delFunc = () => {
          this.log.debug(`SG ${this.key}: Stream disconnected: ${stream.key}`);
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

    //----------
    hlsUpdateMinSegment(id) {
      var prev;
      if (!this.hls_min_id || id > this.hls_min_id) {
        prev = this.hls_min_id;
        this.hls_min_id = id;
        this.emit("hls_update_min_segment", id);
        return this.log.debug(`New HLS min segment id: ${id} (Previously: ${prev})`);
      }
    }

  };

  return Stream;

}).call(this);

//----------

//# sourceMappingURL=stream.js.map
