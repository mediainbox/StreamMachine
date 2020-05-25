import {LoggingWinston as StackdriverLogging} from '@google-cloud/logging-winston';
import * as CustomTransports from "./transports";
import cluster from 'cluster';
import winston, {Logger} from "winston";
import * as os from "os";
import {LoggerConfig} from "../types";

const {combine, timestamp, label, json, errors} = winston.format;

let loggerInstance: Logger;

export function createLogger(mode: string, config: LoggerConfig): Logger {
  console.log(`[logger] create logger`);

  const transports = [];

  // debug transport to stdout if not prod
  if (process.env.NODE_ENV !== 'production') {
    console.log("[logger] add debug transport");
    transports.push(new CustomTransports.DebugTransport());
  }

  // json file output
  if (config.transports.json) {
    console.log("[logger] adding json file transport");
    transports.push(new winston.transports.File({
      level: config.transports.json.level,
      filename: config.transports.json.file,
      maxsize: 10 * 1024 * 1024,
    }));
  }

  // gcp stackdriver
  if (config.transports.stackdriver) {
    console.log("[logger] adding stackdriver transport");
    transports.push(new StackdriverLogging({
      // TODO: fix
      //logName: 'stream_machine',
      level: config.transports.stackdriver.level,
      /*serviceContext: {
        service: 'stream-machine',
        version: '1.0.0'
      },*/
      labels: {
        //mode: mode,
        //env: config.env
      },
    }));
  }

  const addMetadata = winston.format(function (info) {
    info.hostname = os.hostname();
    info.pid = process.pid;
    info.workerId = cluster.isWorker ? cluster.worker.id : undefined;
    return info;
  });

  // create a winston logger for this instance
  const logger = winston.createLogger({
    format: combine(
      addMetadata(),
      errors({stack: true}),
      timestamp(),
      json(),
    ),
    level: config.level,
    transports: transports
  });

  winston.addColors((winston.config as any).npm.levels);

  loggerInstance = logger;
  return logger;
}

export function getLogger(): Logger {
  if (!loggerInstance) {
    throw new Error('Logger not initialized');
  }

  return loggerInstance;
}

export function componentLogger(name: string): Logger {
  return getLogger().child({
    component: name
  });
}
