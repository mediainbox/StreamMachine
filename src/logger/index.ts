import {LoggingWinston as StackdriverLogging} from '@google-cloud/logging-winston';
import * as CustomTransports from "./transports";
import cluster from 'cluster';
import winston from "winston";
import {SlaveConfig_V1} from "../slave/types";
import * as os from "os";

const {combine, timestamp, label, json, errors } = winston.format;

export function createLogger(config: SlaveConfig_V1) {
  console.log(`[logger] create logger (mode: ${config.mode})`);

  const transports = [];

  // debug transport to stdout if not prod
  if (process.env.NODE_ENV !== 'production') {
    transports.push(new CustomTransports.DebugTransport());
  }

  // json file output
  if (config.log.json) {
    console.log("[logger] adding file json transport");
    transports.push(new winston.transports.File({
      level: config.log.json.level,
      filename: config.log.json.file,
      maxsize: 10 * 1024 * 1024,
    }));
  }

  // gcp stackdriver
  if (config.log.stackdriver) {
    console.log("[logger] adding stackdriver transport");
    transports.push(new StackdriverLogging({
      logName: 'stream_machine',
      level: config.log.stackdriver.level,
      serviceContext: {
        service: 'stream-machine',
        version: '1.0.0'
      },
      prefix: config.mode,
      labels: {
        mode: config.mode,
        //env: config.env
      },
    }));
  }

  const addMetadata = winston.format(function(info) {
    info.hostname = os.hostname();
    info.pid = process.pid;
    info.workerId = cluster.isWorker ? cluster.worker.id : undefined;
    return info;
  });

  // create a winston logger for this instance
  const logger = winston.createLogger({
    format: combine(
      addMetadata(),
      errors({ stack: true }),
      timestamp(),
      json(),
    ),
    //level: 'info',
    level: 'debug',
    transports: transports
  });

  winston.addColors((winston.config as any).npm.levels);

  return logger;
}
