import express from "express";
import * as http from "http";
import {Server} from "http";
import * as path from "path";
import cluster from "cluster";
import {componentLogger} from "../../logger";
import {SlaveConfig} from "../config/types";

const greenlock = require("greenlock-express");

export function buildHttpServer(
  app: express.Application,
  config: SlaveConfig
): Server {
  const logger = componentLogger('http_server');

  const serverConfig = config.server;

  if (!serverConfig.useGreenlock) {
    if (cluster.isMaster && config.cluster.enabled) {
      console.log(`Master ${process.pid} is running`);

      // Fork workers.
      for (let i = 0; i < config.cluster.workers; i++) {
        cluster.fork();
      }

      cluster.on('exit', (worker, code, signal) => {
        logger.warn(`worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
        cluster.fork();
      });

      return http.createServer(app).listen(serverConfig.httpPort);
    } else {
      logger.info(`Setup http server on port ${serverConfig.httpIp}:${serverConfig.httpPort}`);

      console.log(`Worker ${process.pid} started`);
      return http.createServer(app).listen(serverConfig.httpPort);
    }
  }

  logger.info(`Init Greenlock http/https servers with ${config.cluster} workers`);
  logger.info(`Setup http server on ${serverConfig.httpIp}:${serverConfig.httpPort}`);
  logger.info(`Setup https server on ${serverConfig.httpsIp}:${serverConfig.httpsPort}`);

  const packageRoot = path.resolve(__dirname, '../../../..');

  return greenlock.init({
    packageRoot,
    configDir: "./greenlock.d",
    cluster: true,
    workers: config.cluster,
    maintainerEmail: "contact@mediainbox.io"
  }).ready(function (glx: any) {
    const plainServer = glx.httpServer(app);

    return plainServer.listen(serverConfig.httpPort, serverConfig.httpIp, function () {
      const secureServer = glx.httpsServer(null, app);

      return secureServer.listen(serverConfig.httpsPort, serverConfig.httpsIp, function () {
        plainServer.removeAllListeners('error');
        secureServer.removeAllListeners('error');
        console.log("Greenlock: cluster child on PID " + process.pid);
      });
    });
  }).master(() => {
    console.log("Greenlock: master on PID " + process.pid);
  });
}
