var ProxySource, RewindBuffer, Stream, URL, _, uuid;

_ = require("underscore");

uuid = require("node-uuid");

URL = require("url");

RewindBuffer = require('../../rewind/rewind_buffer');

ProxySource = require('../../sources/url_source');

module.exports = Stream = (function() {
  class Stream extends require('events').EventEmitter {
    constructor(ctx, args) {
      var config, newsource, uri;
      super();
      this.ctx = ctx;
      ({key: this.key, mount: this.mount, config} = args);
      this.logger = this.ctx.logger.child({
        component: `stream[${this.key}]`
      });
      this.config = _.defaults(config || {}, this.DefaultOptions);
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
      if (this.config.ffmpeg_args) {
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
      this.logger.info({
        key: this.key,
        config: this.config,
        message: `initialize stream handler for ${this.key}`
      });
      // -- Initialize Master Rewinder -- #

      // set up a rewind buffer, for use in bringing new slaves up to speed
      // or to transfer to a new master when restarting
      this.rewind = new RewindBuffer({
        seconds: this.config.seconds,
        burst: this.config.burst,
        station: this.key,
        key: `master__${this.key}`,
        logger: this.logger.child({
          module: "rewind"
        })
      });
      // Rewind listens to us, not to our source
      this.rewind._rConnectSource(this)
      //this.rewind.emit("source", this);
      // Pass along buffer loads
      this.rewind.on("buffer", (c) => {
        return this.emit("buffer", c);
      });
      // -- Set up data functions -- #
      this._meta = {
        StreamTitle: this.config.metaTitle,
        StreamUrl: ""
      };
      this.sourceMetaFunc = (meta) => {
        if (this.config.acceptSourceMeta) {
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
      if (this.config.fallback != null) {
        // what type of a fallback is this?
        uri = URL.parse(this.config.fallback);
        newsource = (function() {
          switch (uri.protocol) {
            case "file:":
              return new FileSource({
                key: this.key,
                format: this.config.format,
                filePath: uri.path,
                logger: this.logger
              });
            case "http:":
            case "https:":
              return new ProxySource({
                key: this.key,
                format: this.config.format,
                url: this.config.fallback,
                headers: this.config.headers,
                fallback: true,
                logger: this.logger
              });
            default:
              return null;
          }
        }).call(this);
        if (newsource) {
          newsource.once("connect", () => {
            return this.addSource(newsource, (err) => {
              if (err) {
                return this.logger.error("Connection to fallback source failed.");
              } else {
                return this.logger.debug("Fallback source connected.");
              }
            });
          });
          newsource.on("error", (err) => {
            return this.logger.error(`Fallback source error: ${err}`, {
              error: err
            });
          });
        } else {
          this.logger.error(`Unable to determine fallback source type for ${this.config.fallback}`);
        }
      }
    }

    //----------
    _initTranscodingSource() {
      var tsource;
      this.logger.debug(`Setting up transcoding source for ${this.key}`);
      // -- create a transcoding source -- #
      tsource = new TranscodingSource({
        stream: this.mount,
        ffmpeg_args: this.config.ffmpeg_args,
        format: this.config.format,
        logger: this.logger
      });
      this.source = tsource;
      // if our transcoder goes down, restart it
      return tsource.once("disconnect", () => {
        this.logger.error(`Transcoder disconnected for ${this.key}.`);
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
    getConfig() {
      return this.config;
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
          this.config[k] = new_opts[k];
        }
        if (_.isNumber(this.DefaultOptions[k])) {
          // convert to a number if necessary
          this.config[k] = Number(this.config[k]);
        }
      }
      if (this.key !== this.config.key) {
        this.key = this.config.key;
      }
      // did they update the metaTitle?
      if (new_opts.metaTitle) {
        this.setMetadata({
          title: new_opts.metaTitle
        });
      }
      // Update our rewind settings
      this.rewind.setRewind(this.config.seconds, this.config.burst);
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

  return Stream;

}).call(this);

//----------
