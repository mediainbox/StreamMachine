import {StreamsCollection} from "../streams/StreamsCollection";
import {SlaveConfig_V1, SlaveCtx} from "../types";
import express from "express";
import {rootStreamRewrite} from "./middlewares/RootStream";
import {trackingMiddleware} from "./middlewares/Tracking";
import {banClientsMiddleware} from "./middlewares/BanClients";
import {utilityController} from "./utilityController";
import {Events} from "../../events";
import {setupHttpServer} from "./HttpServer";
import {Server} from "http";
import {EventEmitter} from 'events';
import {Logger} from "winston";

const cors = require("cors");
const cookieParser = require('cookie-parser');

export class ListenServer extends EventEmitter {
  private server: Server;
  private readonly logger: Logger;
  private readonly config: SlaveConfig_V1;
  private readonly app: express.Application;

  constructor(
    private readonly streams: StreamsCollection,
    private readonly ctx: SlaveCtx,
  ) {
    super();

    const config = this.config = ctx.config;
    this.logger = ctx.logger.child({
      component: "listen_server",
    })

    const app = this.app = express();
    app.set("x-powered-by", false);
    app.use((req, res, next) => {
      res.set('Server', 'StreamMachine/MediaInbox');
      next();
    });
    app.use(cookieParser());

    if (config.cors?.enabled) {
      this.logger.info("enable cors");
      app.use(cors({
        origin: config.cors.origin || true,
        methods: "GET,HEAD"
      }));
    }

    if (config.behind_proxy) {
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

      req.stream = stream;
      next();
    });

    // url rewriter for root route
    app.use(rootStreamRewrite(this.streams));

    // tracking data for users/session
    app.use(trackingMiddleware(this.streams));

    // requests debug logger
    // TODO: like stackdriver
    if (this.config.debug_incoming_requests) {
    }

    // check user agent for banned clients
    if (this.config.ua_skip) {
      app.use(banClientsMiddleware(this.config.ua_skip, this.logger))
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
      this.logger.debug(`listen request for ${req.stream.getId()} from ip ${req.ip}`);

      this.ctx.events.emit(Events.Listener.LANDED, {
        stream: req.stream,
        req,
        res,
      });
    });

    this.server = setupHttpServer({ app, ctx });
  }
};
