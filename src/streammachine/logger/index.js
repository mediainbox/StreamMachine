const _ = require("lodash");
const StackdriverLogging = require('@google-cloud/logging-winston').LoggingWinston;
const CustomTransports = require("./transports");
const cluster = require('cluster');
const winston = require("winston");
const {combine, timestamp, label, json} = winston.format;

debug = require("debug")("sm:logger");

module.exports = {
  createLogger: function(config) {
    debug(`create logger (mode: ${config.mode})`);

    const transports = [];

    // debug transport to stdout
    transports.push(new CustomTransports.DebugTransport());

    // json file output
    if (config.log.json) {
      debug("adding file json transport");
      transports.push(new winston.transports.File({
        level: config.log.json.level || 'debug',
        filename: config.log.json.file,
        options: {
          flags: 'a',
          highWaterMark: 24
        }
      }));
    }

    // gcp stackdriver
    if (config.log.stackdriver) {
      debug("adding stackdriver transport");
      transports.push(new StackdriverLogging({
        name: "stackdriver",
        logName: 'stream_machine',
        level: config.log.stackdriver.level || 'debug',
        serviceContext: {
          service: 'stream-machine',
          version: '1.0.0'
        },
        prefix: config.mode,
        labels: {
          mode: config.mode,
          env: config.env
        },
      }));
    }

    const addMetadata = winston.format(function(info) {
      info.workerId = cluster.isWorker ? cluster.worker.id : undefined;
      return info;
    });

    // create a winston logger for this instance
    const logger = winston.createLogger({
      format: combine(
        addMetadata(),
        timestamp(),
        json()
      ),
      level: 'debug',
      transports: transports
    });

    winston.addColors(winston.config.npm.levels);

    return logger;
  }
};
