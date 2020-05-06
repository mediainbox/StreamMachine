var ConsoleTransport, DebugTransport, SocketLogger, Transport, W3CLogger, WinstonCommon, debug, fs, path, strftime, winston;

winston = require("winston");

WinstonCommon = require("winston/lib/winston/common");

fs = require("fs");

path = require("path");

strftime = require("prettydate").strftime;

Transport = require('winston-transport');

debug = require("debug");

DebugTransport = (function() {
  class DebugTransport extends Transport {
    constructor(opts) {
      super(opts);
      this.defaultFn = require("debug")("sm:log");
      this.debugFnByComponent = {};
    }

    getDebugFn(component) {
      var fn;
      fn = this.debugFnByComponent[component];
      if (!fn) {
        fn = debug('sm:' + component);
        this.debugFnByComponent[component] = fn;
      }
      return fn;
    }

    log(info, callback) {
      var fn;
      fn = info.component ? this.getDebugFn(info.component) : this.defaultFn;
      fn(`[${info.level.toUpperCase()}] ${info.message}`);
      return callback(null, true);
    }

  };

  DebugTransport.prototype.name = "debug";

  return DebugTransport;

}).call(this);

//----------
ConsoleTransport = class ConsoleTransport extends winston.transports.Console {
  constructor(opts) {
    super(opts);
    this.opts = opts;
    this.ignore_levels = (this.opts.ignore || "").split(",");
  }

  log(info, callback) {
    var i, k, len, output, prefixes, ref;
    if (this.silent) {
      return callback(null, true);
    }
    if (this.ignore_levels.indexOf(level) !== -1) {
      return callback(null, true);
    }
    // extract prefix elements from meta
    prefixes = [];
    ref = ['pid', 'mode', 'component'];
    for (i = 0, len = ref.length; i < len; i++) {
      k = ref[i];
      if (info[k]) {
        prefixes.push(info[k]);
        delete info[k];
      }
    }
    output = WinstonCommon.log({
      colorize: this.colorize,
      json: this.json,
      level: level,
      message: msg,
      meta: info,
      stringify: this.stringify,
      timestamp: this.timestamp,
      prettyPrint: this.prettyPrint,
      raw: this.raw,
      label: this.label
    });
    if (prefixes.length > 0) {
      output = prefixes.join("/") + " -- " + output;
    }
    if (level === 'error' || level === 'debug') {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }
    this.emit("logged");
    return callback(null, true);
  }

};

W3CLogger = (function() {
  //----------
  class W3CLogger extends winston.Transport {
    constructor(options) {
      super(options);
      this.options = options;
      this._opening = false;
      this._file = null;
      this._queue = [];
      process.addListener("SIGHUP", () => {
        console.log("w3c reloading log file");
        return this.close(() => {
          return this.open();
        });
      });
    }

    //----------
    log(level, msg, meta, cb) {
      var logline;
      // unlike a normal logging endpoint, we only care about our request entries
      if (level === this.options.level) {
        // for a valid w3c log, level should == "request", meta.
        logline = `${meta.ip} ${strftime(new Date(meta.time), "%F %T")} ${meta.path} 200 ${escape(meta.ua)} ${meta.bytes} ${meta.seconds}`;
        this._queue.push(logline);
        return this._runQueue();
      }
    }

    //----------
    _runQueue() {
      var line;
      if (this._file) {
        // we're open, so do a write...
        if (this._queue.length > 0) {
          line = this._queue.shift();
          return this._file.write(line + "\n", "utf8", () => {
            if (this._queue.length > 0) {
              return this._runQueue;
            }
          });
        }
      } else {
        return this.open((err) => {
          return this._runQueue();
        });
      }
    }

    //----------
    open(cb) {
      var initFile, stats;
      if (this._opening) {
        console.log("W3C already opening... wait.");
        // we're already trying to open.  return an error so we queue the message
        return false;
      }
      console.log("W3C opening log file.");
      // note that we're opening, and also set a timeout to make sure
      // we don't get stuck
      this._opening = setTimeout(() => {
        console.log("Failed to open w3c log within one second.");
        this._opening = false;
        return this.open(cb);
      }, 1000);
      // is this a new file or one that we're just re-opening?
      initFile = true;
      if (fs.existsSync(this.options.filename)) {
        // file exists...  see if there's anything in it
        stats = fs.statSync(this.options.filename);
        if (stats.size > 0) {
          // existing file...  don't write headers, just open so we can
          // start appending
          initFile = false;
        }
      }
      this._file = fs.createWriteStream(this.options.filename, {
        flags: (initFile ? "w" : "r+")
      });
      return this._file.once("open", (err) => {
        var _clear;
        console.log("w3c log open with ", err);
        _clear = () => {
          console.log("w3c open complete");
          if (this._opening) {
            clearTimeout(this._opening);
          }
          this._opening = null;
          return typeof cb === "function" ? cb() : void 0;
        };
        if (initFile) {
          // write our initial w3c lines before we return
          return this._file.write("#Software: StreamMachine\n#Version: 0.2.9\n#Fields: c-ip date time cs-uri-stem c-status cs(User-Agent) sc-bytes x-duration\n", "utf8", () => {
            return _clear();
          });
        } else {
          return _clear();
        }
      });
    }

    //----------
    close(cb) {
      var ref;
      if ((ref = this._file) != null) {
        ref.end(null, null, () => {
          return console.log("W3C log file closed.");
        });
      }
      return this._file = null;
    }

    //----------
    flush() {
      return this._runQueue();
    }

  };

  W3CLogger.prototype.name = "w3c";

  return W3CLogger;

}).call(this);

SocketLogger = (function() {
  //----------
  class SocketLogger extends winston.Transport {
    constructor(io, opts) {
      super(opts);
      this.io = io;
    }

    log(level, msg, meta, cb) {
      this.io.log({
        level: level,
        msg: msg,
        meta: meta
      });
      return typeof cb === "function" ? cb() : void 0;
    }

  };

  SocketLogger.prototype.name = "socket";

  return SocketLogger;

}).call(this);

module.exports = {
  DebugTransport: DebugTransport,
  ConsoleTransport: ConsoleTransport,
  W3CLogger: W3CLogger,
  SocketLogger: SocketLogger
};

//# sourceMappingURL=transports.js.map
