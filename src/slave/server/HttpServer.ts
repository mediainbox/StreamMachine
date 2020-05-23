import express from "express";
import {SlaveCtx} from "../types";
import * as http from "http";
import * as path from "path";
import { Server } from "http";
import cluster from "cluster";
const greenlock = require("greenlock-express");

export function setupHttpServer({ app, ctx }: { app: express.Application, ctx: SlaveCtx }): Server {
  const config = ctx.config;
  const logger = ctx.logger.child({
    component: 'http_server',
  });

  if (process.env.NO_GREENLOCK) {
    if (cluster.isMaster && config.cluster > 1) {
      console.log(`Master ${process.pid} is running`);

      // Fork workers.
      for (let i = 0; i < config.cluster; i++) {
        cluster.fork();
      }

      cluster.on('exit', (worker, code, signal) => {
        console.log(`worker ${worker.process.pid} died`);
      });
      return {} as any;
    } else {
      logger.info("setup http server on port " + config.http_port);

      console.log(`Worker ${process.pid} started`);
      return http.createServer(app).listen(config.http_port || 80);
    }
  }

  logger.info(`init Greenlock http/https servers with ${config.cluster} workers`);
  logger.info(`setup http/s server on ports ${config.http_port}/${config.https_port}`);
  const packageRoot = path.resolve(__dirname, '../../../..');

  return greenlock.init({
    packageRoot,
    configDir: "./greenlock.d",
    cluster: true,
    workers: config.cluster,
    maintainerEmail: "contact@mediainbox.io"
  }).ready(function(glx: any) {
    const plainServer = glx.httpServer(app);
    const plainAddr = config.http_ip || '0.0.0.0';
    const plainPort = config.http_port || 80;

    return plainServer.listen(plainPort, plainAddr, function() {
      const secureServer = glx.httpsServer(null, app);
      const secureAddr = config.https_ip || '0.0.0.0';
      const securePort = config.https_port || 443;

      return secureServer.listen(securePort, secureAddr, function() {
        plainServer.removeAllListeners('error');
        secureServer.removeAllListeners('error');
        return console.log("Greenlock: cluster child on PID " + process.pid);
      });
    });
  }).master(() => {
    return console.log("Greenlock: master on PID " + process.pid);
  });
}
