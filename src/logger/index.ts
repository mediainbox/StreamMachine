import {LoggingWinston as StackdriverLogging} from '@google-cloud/logging-winston';
import * as CustomTransports from "./transports";
import cluster from 'cluster';
import winston, {Logger} from "winston";
import * as os from "os";
import {LoggerConfig} from "./config";

const {combine, timestamp, label, json, errors} = winston.format;

let loggerInstance: Logger;

interface Labels extends Record<string, string> {
  readonly app: string;
  readonly env: string;
  readonly version: string;
}

export function createLogger(config: LoggerConfig, labels: Labels): Logger {
  const transports = [];

  // debug transport to stdout if not prod
  if (process.env.NODE_ENV !== 'production') {
    transports.push(new CustomTransports.DebugTransport());
  }

  // json file output
  const cJson = config.transports?.json;
  if (cJson) {
    transports.push(new winston.transports.File({
      level: cJson.level,
      filename: cJson.file,
      maxsize: 10 * 1024 * 1024,
    }));
  }

  // gcp stackdriver
  const cStackdriver = config.transports?.stackdriver;
  if (cStackdriver) {
    transports.push(new StackdriverLogging({
      logName: 'stream_machine',
      level: cStackdriver.level,
      serviceContext: cStackdriver.serviceContext,
      prefix: labels.app,
      labels
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
      errors({ stack: true }),
      timestamp(),
      json(),
    ),
    level: config.level,
    transports
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
