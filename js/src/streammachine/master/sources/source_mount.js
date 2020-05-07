var SourceMount, _;

_ = require("underscore");

module.exports = SourceMount = (function() {
  class SourceMount extends require("events").EventEmitter {
    constructor(key, logger, opts) {
      super();
      this.key = key;
      this.config = _.defaults(opts || {}, this.DefaultOptions);
      this.logger = logger.child({
        component: `source_mount:${this.key}`
      });
      this.sources = [];
      this.source = null;
      // Support the old streams-style password key
      this.password = this.config.password || this.config.source_password;
      this._vitals = null;
      this.logger.debug(`initialize source mount stream ${this.key}`);
      this.dataFunc = (data) => {
        return this.emit("data", data);
      };
      this.vitalsFunc = (vitals) => {
        this._vitals = vitals;
        return this.emit("vitals", vitals);
      };
    }

    //----------
    status() {
      var s;
      return {
        key: this.key,
        sources: (function() {
          var i, len, ref, results;
          ref = this.sources;
          results = [];
          for (i = 0, len = ref.length; i < len; i++) {
            s = ref[i];
            results.push(s.status());
          }
          return results;
        }).call(this)
      };
    }

    //----------
    getConfig() {
      return this.config;
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
      // support changing our key
      if (this.key !== this.config.key) {
        this.key = this.config.key;
      }
      // Support the old streams-style password key
      this.password = this.config.password || this.config.source_password;
      this.emit("config");
      return typeof cb === "function" ? cb(null, this.config()) : void 0;
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
    addSource(source, cb) {
      var ref, ref1, ref2;
      // add a disconnect monitor
      source.once("disconnect", () => {
        // remove it from the list
        this.sources = _(this.sources).without(source);
        // was this our current source?
        if (this.source === source) {
          // yes...  need to promote the next one (if there is one)
          if (this.sources.length > 0) {
            this.useSource(this.sources[0]);
            return this.emit("disconnect", {
              active: true,
              count: this.sources.length,
              source: this.source
            });
          } else {
            this.logger.warn("Source disconnected. No sources remaining.");
            this._disconnectSource(this.source);
            this.source = null;
            return this.emit("disconnect", {
              active: true,
              count: 0,
              source: null
            });
          }
        } else {
          // no... just remove it from the list
          this.logger.info("Inactive source disconnected.");
          return this.emit("disconnect", {
            active: false,
            count: this.sources.length,
            source: this.source
          });
        }
      });
      // -- Add the source to our list -- #
      this.sources.push(source);
      // -- Should this source be made active? -- #

      // check whether this source should be made active. It should be if
      // the active source is defined as a fallback
      if (this.sources[0] === source || ((ref = this.sources[0]) != null ? ref.isFallback : void 0)) {
        // our new source should be promoted
        this.logger.info("Promoting new source to active.", {
          source: (ref1 = typeof source.TYPE === "function" ? source.TYPE() : void 0) != null ? ref1 : source.TYPE
        });
        return this.useSource(source, cb);
      } else {
        // add the source to the end of our list
        this.logger.info("Source connected.", {
          source: (ref2 = typeof source.TYPE === "function" ? source.TYPE() : void 0) != null ? ref2 : source.TYPE
        });
        // and emit our source event
        this.emit("add_source", source);
        return typeof cb === "function" ? cb(null) : void 0;
      }
    }

    //----------
    _disconnectSource(source) {
      //source.removeListener "metadata",   @sourceMetaFunc
      source.removeListener("data", this.dataFunc);
      return source.removeListener("vitals", this.vitalsFunc);
    }

    //----------
    useSource(newsource, cb) {
      var alarm, old_source;
      // stash our existing source if we have one
      old_source = this.source || null;
      // set a five second timeout for the switchover
      alarm = setTimeout(() => {
        var ref, ref1;
        this.logger.error("useSource failed to get switchover within five seconds.", {
          new_source: (ref = typeof newsource.TYPE === "function" ? newsource.TYPE() : void 0) != null ? ref : newsource.TYPE,
          old_source: (ref1 = old_source != null ? typeof old_source.TYPE === "function" ? old_source.TYPE() : void 0 : void 0) != null ? ref1 : old_source != null ? old_source.TYPE : void 0
        });
        return typeof cb === "function" ? cb(new Error("Failed to switch.")) : void 0;
      }, 5000);
      // Look for a header before switching
      return newsource.vitals((err, vitals) => {
        var base, ref, ref1, ref2;
        if (this.source && old_source !== this.source) {
          // source changed while we were waiting for vitals. we'll
          // abort our change attempt
          this.logger.info("Source changed while waiting for vitals.", {
            new_source: (ref = typeof newsource.TYPE === "function" ? newsource.TYPE() : void 0) != null ? ref : newsource.TYPE,
            old_source: (ref1 = old_source != null ? typeof old_source.TYPE === "function" ? old_source.TYPE() : void 0 : void 0) != null ? ref1 : old_source != null ? old_source.TYPE : void 0,
            current_source: (ref2 = typeof (base = this.source).TYPE === "function" ? base.TYPE() : void 0) != null ? ref2 : this.source.TYPE
          });
          return typeof cb === "function" ? cb(new Error("Source changed while waiting for vitals.")) : void 0;
        }
        if (old_source) {
          // unhook from the old source's events
          this._disconnectSource(old_source);
        }
        this.source = newsource;
        // connect to the new source's events
        //newsource.on "metadata",   @sourceMetaFunc
        newsource.on("data", this.dataFunc);
        newsource.on("vitals", this.vitalsFunc);
        // how often will we be emitting?
        this.emitDuration = vitals.emitDuration;
        // note that we've got a new source
        process.nextTick(() => {
          var ref3, ref4;
          this.logger.info("New source is active.", {
            new_source: (ref3 = typeof newsource.TYPE === "function" ? newsource.TYPE() : void 0) != null ? ref3 : newsource.TYPE,
            old_source: (ref4 = old_source != null ? typeof old_source.TYPE === "function" ? old_source.TYPE() : void 0 : void 0) != null ? ref4 : old_source != null ? old_source.TYPE : void 0
          });
          this.emit("source", newsource);
          return this.vitalsFunc(vitals);
        });
        // jump our new source to the front of the list (and remove it from
        // anywhere else in the list)
        this.sources = _.flatten([newsource, _(this.sources).without(newsource)]);
        // cancel our timeout
        clearTimeout(alarm);
        return typeof cb === "function" ? cb(null) : void 0;
      });
    }

    //----------
    promoteSource(uuid, cb) {
      var ns;
      // do we have a source with this UUID?
      if (ns = _(this.sources).find((s) => {
        return s.uuid === uuid;
      })) {
        // we do...
        // make sure it isn't already the active source, though
        if (ns === this.sources[0]) {
          return typeof cb === "function" ? cb(null, {
            msg: "Source is already active",
            uuid: uuid
          }) : void 0;
        } else {
          // it isn't. we can try to promote it
          return this.useSource(ns, (err) => {
            if (err) {
              return typeof cb === "function" ? cb(err) : void 0;
            } else {
              return typeof cb === "function" ? cb(null, {
                msg: "Promoted source to active.",
                uuid: uuid
              }) : void 0;
            }
          });
        }
      } else {
        return typeof cb === "function" ? cb(`Unable to find a source with that UUID on ${this.key}`) : void 0;
      }
    }

    //----------
    dropSource(uuid, cb) {}

    //----------
    destroy() {
      var i, len, ref, s;
      ref = this.sources;
      for (i = 0, len = ref.length; i < len; i++) {
        s = ref[i];
        s.disconnect();
      }
      this.emit("destroy");
      return this.removeAllListeners();
    }

  };

  SourceMount.prototype.DefaultOptions = {
    monitored: false,
    password: false,
    source_password: false,
    format: "mp3"
  };

  return SourceMount;

}).call(this);

//# sourceMappingURL=source_mount.js.map
