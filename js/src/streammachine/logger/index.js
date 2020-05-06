var StackdriverLogging, _, combine, customTransports, debug, label, prettyPrint, timestamp, winston;

_ = require("underscore");

StackdriverLogging = require('@google-cloud/logging-winston').LoggingWinston;

customTransports = require("./transports");

winston = require("winston");

({combine, timestamp, label, prettyPrint} = winston.format);

debug = require("debug")("sm:logger");

module.exports = {
  createLogger: function(config) {
    var logger, ref, transports;
    ({
      CustomLevels: {
        error: 80,
        alert: 75,
        event: 70,
        info: 60,
        request: 40,
        interaction: 30,
        minute: 30,
        debug: 10,
        silly: 5
      }
    });
    debug(`create logger (mode: ${config.mode}, env: ${config.env})`);
    transports = [];
    // -- debug -- #
    transports.push(new customTransports.DebugTransport());
    // -- stdout -- #
    if (config.stdout) {
      debug("adding console transport");
      transports.push(new winston.transports.Console({
        colorize: true,
        prettyPrint: true,
        timestamp: true
      }));
    }
    /*
    transports.push new customTransports.ConsoleTransport
        level:      config.stdout?.level        || "debug"
        colorize:   config.stdout?.colorize     || false
        timestamp:  config.stdout?.timestamp    || false
        ignore:     config.stdout?.ignore       || ""
    */
    // -- JSON -- #
    if ((ref = config.json) != null ? ref.file : void 0) {
      debug("Setting up JSON logger with ", config.json);
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
    // -- Stackdriver -- #
    if ((config.stackdriver != null) || 1) {
      debug("adding stackdriver transport");
      transports.push(new StackdriverLogging({
        name: "stackdriver",
        logname: 'stream_machine',
        logName: 'stream_machine',
        prefix: config.mode,
        labels: {
          mode: config.mode,
          env: config.env
        }
      }));
    }
    // create a winston logger for this instance
    logger = winston.createLogger({
      level: 'debug',
      //levels: winston.config.syslog.levels
      transports: transports
    });
    //levels:@CustomLevels
    //, rewriters:[@RequestRewriter]
    winston.addColors(winston.config.npm.levels);
    return logger;
    ({
      //----------

      // connect to our events and proxy interaction and request events through
      // to a master server over WebSockets
      proxyToMaster: function(sock) {
        if (this.logger.transports['socket']) {
          this.logger.remove(this.logger.transports['socket']);
        }
        if (sock) {
          return this.logger.add(new Logger.SocketLogger(sock, {
            level: "interaction"
          }), {}, true);
        }
      }
    });
    //----------
    return this.Child = class Child {
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
          return new Logger.Child(this.parent, _.extend({}, this.opts, opts));
        };
      }

      proxyToMaster(sock) {
        return this.parent.proxyToMaster(sock);
      }

    };
  }
};

//----------

//# sourceMappingURL=index.js.map
