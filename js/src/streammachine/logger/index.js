var CustomTransports, StackdriverLogging, _, cluster, combine, debug, json, label, prettyPrint, timestamp, winston;

_ = require("underscore");

StackdriverLogging = require('@google-cloud/logging-winston').LoggingWinston;

CustomTransports = require("./transports");

cluster = require('cluster');

winston = require("winston");

({combine, timestamp, label, prettyPrint, json} = winston.format);

debug = require("debug")("sm:logger");

module.exports = {
  createLogger: function(config) {
    var addMetadata, logger, ref, transports;
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
    transports.push(new CustomTransports.DebugTransport());
    // -- stdout -- #
    if (false && config.log.stdout) {
      debug("adding console transport");
      transports.push(new winston.transports.Console());
    }
    /*
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
    if (config.stackdriver != null) {
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
    addMetadata = winston.format(function(info) {
      info.workerId = cluster.isWorker && cluster.worker.id;
      return info;
    });
    // create a winston logger for this instance
    logger = winston.createLogger({
      format: combine(addMetadata(), json()),
      level: 'debug', // TODO
      transports: transports
    });
    winston.addColors(winston.config.npm.levels);
    return logger;
  }
};

//# sourceMappingURL=index.js.map
