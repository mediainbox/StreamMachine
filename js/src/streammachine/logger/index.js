var LogController, LoggingWinston, customTransports, debug, fs, path, winston, _,
  __slice = [].slice;

_ = require("underscore");

winston = require("winston");

LoggingWinston = require('@google-cloud/logging-winston').LoggingWinston;

customTransports = require("./transports");

fs = require("fs");

path = require("path");

debug = require("debug")("sm:logger");

module.exports = LogController = (function() {
  LogController.prototype.CustomLevels = {
    error: 80,
    alert: 75,
    event: 70,
    info: 60,
    request: 40,
    interaction: 30,
    minute: 30,
    debug: 10,
    silly: 5
  };

  function LogController(config, mode, env) {
    var transports, _ref, _ref1, _ref2, _ref3, _ref4, _ref5;
    console.log("[logging] configure logger, mode: " + mode + ", env: " + env);
    transports = [];
    transports.push(new customTransports.DebugTransport({
      level: "silly"
    }));
    if (config.stdout) {
      console.log("[logging] adding console transport");
      transports.push(new customTransports.ConsoleTransport({
        level: ((_ref = config.stdout) != null ? _ref.level : void 0) || "debug",
        colorize: ((_ref1 = config.stdout) != null ? _ref1.colorize : void 0) || false,
        timestamp: ((_ref2 = config.stdout) != null ? _ref2.timestamp : void 0) || false,
        ignore: ((_ref3 = config.stdout) != null ? _ref3.ignore : void 0) || ""
      }));
    }
    if ((_ref4 = config.json) != null ? _ref4.file : void 0) {
      console.log("Setting up JSON logger with ", config.json);
      transports.push(new winston.transports.File({
        level: config.json.level || "interaction",
        timestamp: true,
        filename: config.json.file,
        json: true,
        options: {
          flags: 'a',
          highWaterMark: 24
        }
      }));
    }
    if ((_ref5 = config.w3c) != null ? _ref5.file : void 0) {
      transports.push(new customTransports.W3CLogger({
        level: config.w3c.level || "request",
        filename: config.w3c.file
      }));
    }
    if ((config.stackdriver != null) || 1) {
      console.log("[logging] adding stackdriver transport");
      transports.push(new LoggingWinston({
        name: "stackdriver",
        logname: 'stream_machine',
        logName: 'stream_machine',
        prefix: mode,
        labels: {
          mode: mode,
          env: env
        }
      }));
    }
    this.logger = new winston.Logger({
      transports: transports,
      levels: this.CustomLevels
    });
    this.logger.extend(this);
  }

  LogController.prototype.child = function(opts) {
    if (opts == null) {
      opts = {};
    }
    return new LogController.Child(this, opts);
  };

  LogController.prototype.proxyToMaster = function(sock) {
    if (this.logger.transports['socket']) {
      this.logger.remove(this.logger.transports['socket']);
    }
    if (sock) {
      return this.logger.add(new LogController.SocketLogger(sock, {
        level: "interaction"
      }), {}, true);
    }
  };

  LogController.Child = (function() {
    function Child(parent, opts) {
      this.parent = parent;
      this.opts = opts;
      _(['log', 'profile', 'startTimer'].concat(Object.keys(this.parent.logger.levels))).each((function(_this) {
        return function(k) {
          return _this[k] = function() {
            var args;
            args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
            if (_.isObject(args[args.length - 1])) {
              args[args.length - 1] = _.extend({}, args[args.length - 1], _this.opts);
            } else {
              args.push(_.clone(_this.opts));
            }
            return _this.parent[k].apply(_this, args);
          };
        };
      })(this));
      this.logger = this.parent.logger;
      this.child = function(opts) {
        if (opts == null) {
          opts = {};
        }
        return new LogController.Child(this.parent, _.extend({}, this.opts, opts));
      };
    }

    Child.prototype.proxyToMaster = function(sock) {
      return this.parent.proxyToMaster(sock);
    };

    return Child;

  })();

  return LogController;

})();

//# sourceMappingURL=index.js.map
