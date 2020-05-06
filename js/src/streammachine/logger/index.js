var LogController, LoggingWinston, _, customTransports, debug, fs, path, winston;

_ = require("underscore");

winston = require("winston");

LoggingWinston = require('@google-cloud/logging-winston').LoggingWinston;

customTransports = require("./transports");

fs = require("fs");

path = require("path");

debug = require("debug")("sm:logger");

module.exports = LogController = (function() {
  class LogController {
    constructor(config, mode, env) {
      var ref, ref1, ref2, ref3, ref4, ref5, transports;
      console.log(`[logging] configure logger, mode: ${mode}, env: ${env}`);
      transports = [];
      // -- debug -- #
      transports.push(new customTransports.DebugTransport({
        level: "silly"
      }));
      // -- stdout -- #
      if (config.stdout) {
        console.log("[logging] adding console transport");
        transports.push(new customTransports.ConsoleTransport({
          level: ((ref = config.stdout) != null ? ref.level : void 0) || "debug",
          colorize: ((ref1 = config.stdout) != null ? ref1.colorize : void 0) || false,
          timestamp: ((ref2 = config.stdout) != null ? ref2.timestamp : void 0) || false,
          ignore: ((ref3 = config.stdout) != null ? ref3.ignore : void 0) || ""
        }));
      }
      // -- JSON -- #
      if ((ref4 = config.json) != null ? ref4.file : void 0) {
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
      // -- W3C -- #
      if ((ref5 = config.w3c) != null ? ref5.file : void 0) {
        // set up W3C-format logging
        transports.push(new customTransports.W3CLogger({
          level: config.w3c.level || "request",
          filename: config.w3c.file
        }));
      }
      // -- Stackdriver -- #
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
      // create a winston logger for this instance
      this.logger = new winston.Logger({
        transports: transports,
        levels: this.CustomLevels //, rewriters:[@RequestRewriter]
      });
      this.logger.extend(this);
    }

    //----------

      // returns a logger that will automatically merge in the given data
    child(opts = {}) {
      return new LogController.Child(this, opts);
    }

    //----------

      // connect to our events and proxy interaction and request events through
    // to a master server over WebSockets
    proxyToMaster(sock) {
      if (this.logger.transports['socket']) {
        this.logger.remove(this.logger.transports['socket']);
      }
      if (sock) {
        return this.logger.add(new LogController.SocketLogger(sock, {
          level: "interaction"
        }), {}, true);
      }
    }

  };

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

  //----------
  LogController.Child = class Child {
    constructor(parent, opts1) {
      this.parent = parent;
      this.opts = opts1;
      _(['log', 'profile', 'startTimer'].concat(Object.keys(this.parent.logger.levels))).each((k) => {
        return this[k] = (...args) => {
          if (_.isObject(args[args.length - 1])) {
            args[args.length - 1] = _.extend({}, args[args.length - 1], this.opts);
          } else {
            args.push(_.clone(this.opts));
          }
          return this.parent[k].apply(this, args);
        };
      });
      this.logger = this.parent.logger;
      this.child = function(opts = {}) {
        return new LogController.Child(this.parent, _.extend({}, this.opts, opts));
      };
    }

    proxyToMaster(sock) {
      return this.parent.proxyToMaster(sock);
    }

  };

  return LogController;

}).call(this);

//----------

//# sourceMappingURL=index.js.map
