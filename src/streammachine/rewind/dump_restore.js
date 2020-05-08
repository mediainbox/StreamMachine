var RewindDumpRestore, _, fs, path;

path = require("path");

fs = require("fs");

_ = require("underscore");

// RewindDumpRestore is in charge of making periodic backups of a RewindBuffer's
// data. This is important for helping a crashed process get back up to
// speed quickly. The `settings` should define the directory to write
// dump files into and the frequency in seconds with which dumps should
// occur.
module.exports = RewindDumpRestore = (function() {
  var Dumper;

  class RewindDumpRestore extends require('events').EventEmitter {
    constructor(master, settings) {
      var obj, ref, ref1, s;
      super();
      this.master = master;
      this.settings = settings;
      this._streams = {};
      this._queue = [];
      this._working = false;
      this._shouldLoad = false;
      this.logger = this.master.logger.child({
        component: "rewind_dump_restore"
      });
      // -- make sure directory is valid -- #
      this._path = fs.realpathSync(path.resolve(process.cwd(), this.settings.dir));
      if ((ref = (s = fs.statSync(this._path))) != null ? ref.isDirectory() : void 0) {

      } else {
        // good
        this.logger.error(`RewindDumpRestore path (${this._path}) is invalid.`);
        return false;
      }
      ref1 = this.master.streams;
      // -- create agents for each stream -- #
      for (s in ref1) {
        obj = ref1[s];
        this._streams[s] = new Dumper(s, obj.rewind, this._path);
        obj.once("destroy", () => {
          return delete this._streams[s];
        });
      }
      // watch for new streams
      this.master.on("new_stream", (stream) => {
        this.logger.debug(`dump restore received new stream ${stream.key}`);
        return this._streams[stream.key] = new Dumper(stream.key, stream.rewind, this._path);
      });
      // -- set our interval -- #
      if ((this.settings.frequency || -1) > 0) {
        this.logger.debug(`dump restore initialized with ${this.settings.frequency} seconds interval`);
        this._int = setInterval(() => {
          return this._triggerDumps();
        }, this.settings.frequency * 1000);
      }
    }

    //----------
    load(cb) {
      var _load, d, k, load_q, results;
      this._shouldLoad = true;
      load_q = (function() {
        var ref, results1;
        ref = this._streams;
        results1 = [];
        for (k in ref) {
          d = ref[k];
          results1.push(d);
        }
        return results1;
      }).call(this);
      results = {
        success: 0,
        errors: 0
      };
      _load = () => {
        if (d = load_q.shift()) {
          return d._tryLoad((err, stats) => {
            if (err) {
              this.logger.error(`Load for ${d.key} errored: ${err}`, {
                stream: d.key
              });
              results.errors += 1;
            } else {
              this.logger.info(`dump restored for ${d.key}`);
              results.success += 1;
            }
            return _load();
          });
        } else {
          // done
          this.logger.info("dump restore load complete", {
            success: results.success,
            errors: results.errors
          });
          return typeof cb === "function" ? cb(null, results) : void 0;
        }
      };
      return _load();
    }

    //----------
    _triggerDumps(cb) {
      var d, k;
      this.logger.debug("Queuing Rewind dumps");
      this._queue.push(...((function() {
        var ref, results1;
        ref = this._streams;
        results1 = [];
        for (k in ref) {
          d = ref[k];
          results1.push(d);
        }
        return results1;
      }).call(this)));
      if (!this._working) {
        return this._dump(cb);
      }
    }

    //----------
    _dump(cb) {
      var d;
      this._working = true;
      if (d = this._queue.shift()) {
        return d._dump((err, file, timing) => {
          if (err) {
            if (d.stream) {
              this.logger.error(`Dump for ${d.key} errored: ${err}`, {
                stream: d.stream.key
              });
            } else {
              this.logger.error(`Dump for ${d.key} errored (with no stream): ${err}`);
            }
          }
          // for tests...
          this.emit("debug", "dump", d.key, err, {
            file: file,
            timing: timing
          });
          return this._dump(cb);
        });
      } else {
        this._working = false;
        return typeof cb === "function" ? cb() : void 0;
      }
    }

  };

  //----------
  Dumper = class Dumper extends require('events').EventEmitter {
    constructor(key, rewind, _path) {
      super();
      this.key = key;
      this.rewind = rewind;
      this._path = _path;
      this._i = null;
      this._active = false;
      this._loaded = null;
      this._tried_load = false;
      this._filepath = path.join(this._path, `${this.rewind._rkey}.dump`);
    }

    //----------
    _tryLoad(cb) {
      var rs;
      // try loading our filepath. catch the error if it is not found
      rs = fs.createReadStream(this._filepath);
      rs.once("error", (err) => {
        this._setLoaded(false);
        if (err.code === "ENOENT") {
          // not an error. just doesn't exist
          return cb(null);
        }
        return cb(err);
      });
      return rs.once("open", () => {
        return this.rewind.loadBuffer(rs, (err, stats) => {
          this._setLoaded(true);
          return cb(null, stats);
        });
      });
    }

    //----------
    _setLoaded(status) {
      this._loaded = status;
      this._tried_load = true;
      return this.emit("loaded", status);
    }

    //----------
    once_loaded(cb) {
      if (this._tried_load) {
        return typeof cb === "function" ? cb() : void 0;
      } else {
        return this.once("loaded", cb);
      }
    }

    //----------
    _dump(cb) {
      var start_ts, w;
      if (this._active) {
        cb(new Error(`RewindDumper failed: Already active for ${this.rewind._rkey}`));
        return false;
      }
      if (this.rewind.isLoading()) {
        cb(new Error("RewindDumper: Cannot dump while rewind buffer is loading."));
        return false;
      }
      this._active = true;
      start_ts = _.now();
      cb = _.once(cb);
      // -- open our output file -- #

      // To make sure we don't crash mid-write, we want to write to a temp file
      // and then get renamed to our actual filepath location.
      w = fs.createWriteStream(`${this._filepath}.new`);
      w.once("open", () => {
        return this.rewind.dumpBuffer((err, writer) => {
          writer.pipe(w);
          return w.once("close", () => {
            var af;
            if (w.bytesWritten === 0) {
              err = null;
              af = _.after(2, () => {
                var end_ts;
                end_ts = _.now();
                this._active = false;
                return cb(err, null, end_ts - start_ts);
              });
              fs.unlink(`${this._filepath}.new`, (e) => {
                if (e) {
                  err = e;
                }
                return af();
              });
              // we also want to unlink any existing dump file
              return fs.unlink(this._filepath, (e) => {
                if (e && e.code !== "ENOENT") {
                  err = e;
                }
                return af();
              });
            } else {
              return fs.rename(`${this._filepath}.new`, this._filepath, (err) => {
                var end_ts;
                if (err) {
                  cb(err);
                  return false;
                }
                end_ts = _.now();
                this._active = false;
                return cb(null, this._filepath, end_ts - start_ts);
              });
            }
          });
        });
      });
      return w.on("error", (err) => {
        return cb(err);
      });
    }

  };

  return RewindDumpRestore;

}).call(this);
