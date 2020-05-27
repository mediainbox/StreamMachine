import {StreamsCollection} from "../streams/StreamsCollection";
import express from "express";
import {rootStreamRewrite} from "./middlewares/RootStream";
import {trackingMiddleware} from "./middlewares/Tracking";
import {banClientsMiddleware} from "./middlewares/BanClients";
import {utilityController} from "./utilityController";
import {Server} from "http";
import {EventEmitter} from 'events';
import {Logger} from "winston";
import {componentLogger} from "../../logger";
import {SlaveEvent, slaveEvents} from "../events";
import {SlaveConfig} from "../types/config";

const cors = require("cors");
const cookieParser = require('cookie-parser');

type ServerConfig = SlaveConfig['server'];

export class ListenServer extends EventEmitter {
  private readonly logger: Logger;
  private readonly app: express.Application;

  constructor(
    private readonly config: ServerConfig,
    private readonly streams: StreamsCollection,
  ) {
    super();

    this.logger = componentLogger("listen_server");

    const app = this.app = express();
    app.set("x-powered-by", false);
    app.use((req, res, next) => {
      res.set('Server', 'StreamMachine/MediaInbox');
      next();
    });
    app.use(cookieParser());

    if (config.cors.enabled) {
      this.logger.info("enable cors");
      app.use(cors({
        origin: config.cors.origin || true,
        methods: "GET,HEAD"
      }));
    }

    if (config.behindProxy) {
      this.logger.info("enable 'trust proxy' for express");
      app.set("trust proxy", true);
    }

    // :stream parameter load and validation for requests
    app.param("stream", (req, res, next, key) => {
      const stream = this.streams.get(key);

      if (!stream) {
        res.status(404).end("Invalid stream.\n");
        return;
      }

      req.sStream = stream;
      next();
    });

    // url rewriter for root route
    app.use(rootStreamRewrite(this.streams));

    // tracking data for users/session
    app.use(trackingMiddleware(this.streams));

    // requests debug logger
    // TODO: like stackdriver
    if (this.config.logRequests) {
    }

    // check user agent for banned clients
    if (this.config.blockUserAgents?.length) {
      app.use(banClientsMiddleware(this.config.blockUserAgents, this.logger))
    }

    // utility routes
    app.get("/index.html", utilityController.index);
    app.get("/crossdomain.xml", utilityController.crossdomain);

    // listener routes for stream
    app.head("/:stream", (req, res) => {
      res.set("content-type", "audio/mpeg");
      res.status(200).end();
    });

    // listen to the stream
    app.get("/:stream", (req, res) => {
      this.logger.debug(`Listen request for ${req.sStream.getId()} from ip ${req.ip}`);

      slaveEvents().emit(SlaveEvent.LISTENER_LANDED, {
        stream: req.sStream,
        req,
        res,
      });
    });
  }

  getApp() {
    return this.app;
  }
}
