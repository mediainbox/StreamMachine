var ConsoleTransport, DebugTransport, LoggingWinston, SocketLogger, Transport, W3CLogger, WinstonCommon, fs, path, strftime, winston,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

winston = require("winston");

WinstonCommon = require("winston/lib/winston/common");

LoggingWinston = require('@google-cloud/logging-winston').LoggingWinston;

fs = require("fs");

path = require("path");

strftime = require("prettydate").strftime;

Transport = require('winston-transport');

DebugTransport = (function(_super) {
  __extends(DebugTransport, _super);

  function DebugTransport() {
    return DebugTransport.__super__.constructor.apply(this, arguments);
  }

  DebugTransport.prototype.name = "debug";

  DebugTransport.prototype.log = function(level, msg, meta, callback) {
    debug("" + level + ": " + msg, meta);
    return callback(null, true);
  };

  return DebugTransport;

})(winston.Transport);

ConsoleTransport = (function(_super) {
  __extends(ConsoleTransport, _super);

  function ConsoleTransport(opts) {
    this.opts = opts;
    ConsoleTransport.__super__.constructor.call(this, this.opts);
    this.ignore_levels = (this.opts.ignore || "").split(",");
  }

  ConsoleTransport.prototype.log = function(level, msg, meta, callback) {
    var k, output, prefixes, _i, _len, _ref;
    if (this.silent) {
      return callback(null, true);
    }
    if (this.ignore_levels.indexOf(level) !== -1) {
      return callback(null, true);
    }
    prefixes = [];
    _ref = ['pid', 'mode', 'component'];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      k = _ref[_i];
      if (meta[k]) {
        prefixes.push(meta[k]);
        delete meta[k];
      }
    }
    output = WinstonCommon.log({
      colorize: this.colorize,
      json: this.json,
      level: level,
      message: msg,
      meta: meta,
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
  };

  return ConsoleTransport;

})(winston.transports.Console);

W3CLogger = (function(_super) {
  __extends(W3CLogger, _super);

  W3CLogger.prototype.name = "w3c";

  function W3CLogger(options) {
    W3CLogger.__super__.constructor.call(this, options);
    this.options = options;
    this._opening = false;
    this._file = null;
    this._queue = [];
    process.addListener("SIGHUP", (function(_this) {
      return function() {
        console.log("w3c reloading log file");
        return _this.close(function() {
          return _this.open();
        });
      };
    })(this));
  }

  W3CLogger.prototype.log = function(level, msg, meta, cb) {
    var logline;
    if (level === this.options.level) {
      logline = "" + meta.ip + " " + (strftime(new Date(meta.time), "%F %T")) + " " + meta.path + " 200 " + (escape(meta.ua)) + " " + meta.bytes + " " + meta.seconds;
      this._queue.push(logline);
      return this._runQueue();
    }
  };

  W3CLogger.prototype._runQueue = function() {
    var line;
    if (this._file) {
      if (this._queue.length > 0) {
        line = this._queue.shift();
        return this._file.write(line + "\n", "utf8", (function(_this) {
          return function() {
            if (_this._queue.length > 0) {
              return _this._runQueue;
            }
          };
        })(this));
      }
    } else {
      return this.open((function(_this) {
        return function(err) {
          return _this._runQueue();
        };
      })(this));
    }
  };

  W3CLogger.prototype.open = function(cb) {
    var initFile, stats;
    if (this._opening) {
      console.log("W3C already opening... wait.");
      return false;
    }
    console.log("W3C opening log file.");
    this._opening = setTimeout((function(_this) {
      return function() {
        console.log("Failed to open w3c log within one second.");
        _this._opening = false;
        return _this.open(cb);
      };
    })(this), 1000);
    initFile = true;
    if (fs.existsSync(this.options.filename)) {
      stats = fs.statSync(this.options.filename);
      if (stats.size > 0) {
        initFile = false;
      }
    }
    this._file = fs.createWriteStream(this.options.filename, {
      flags: (initFile ? "w" : "r+")
    });
    return this._file.once("open", (function(_this) {
      return function(err) {
        var _clear;
        console.log("w3c log open with ", err);
        _clear = function() {
          console.log("w3c open complete");
          if (_this._opening) {
            clearTimeout(_this._opening);
          }
          _this._opening = null;
          return typeof cb === "function" ? cb() : void 0;
        };
        if (initFile) {
          return _this._file.write("#Software: StreamMachine\n#Version: 0.2.9\n#Fields: c-ip date time cs-uri-stem c-status cs(User-Agent) sc-bytes x-duration\n", "utf8", function() {
            return _clear();
          });
        } else {
          return _clear();
        }
      };
    })(this));
  };

  W3CLogger.prototype.close = function(cb) {
    var _ref;
    if ((_ref = this._file) != null) {
      _ref.end(null, null, (function(_this) {
        return function() {
          return console.log("W3C log file closed.");
        };
      })(this));
    }
    return this._file = null;
  };

  W3CLogger.prototype.flush = function() {
    return this._runQueue();
  };

  return W3CLogger;

})(winston.Transport);

SocketLogger = (function(_super) {
  __extends(SocketLogger, _super);

  SocketLogger.prototype.name = "socket";

  function SocketLogger(io, opts) {
    this.io = io;
    SocketLogger.__super__.constructor.call(this, opts);
  }

  SocketLogger.prototype.log = function(level, msg, meta, cb) {
    this.io.log({
      level: level,
      msg: msg,
      meta: meta
    });
    return typeof cb === "function" ? cb() : void 0;
  };

  return SocketLogger;

})(winston.Transport);

module.exports = {
  DebugTransport: DebugTransport,
  ConsoleTransport: ConsoleTransport,
  W3CLogger: W3CLogger,
  SocketLogger: SocketLogger
};

//# sourceMappingURL=transports.js.map
