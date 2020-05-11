const express = require('express');
const cors = require("cors");
const { EventEmitter } = require('events');
const bannedClientsMiddleware = require('./middlewares/banned_clients');
const rootStreamRewrite = require('./middlewares/root_stream');
const trackingMiddleware = require('./middlewares/tracking');
const utilityController = require('./utility_controller');
const setupHttpServer = require('./http_server');
const { get } = require('lodash');
const cookieParser = require('cookie-parser');
const {Events} = require('../../events');

module.exports = class ListenServer extends EventEmitter {
  constructor({ streams, ctx }) {
    super();

    this.ctx = ctx;
    this.streams = streams;
    const config = this.config = ctx.config;

    this.logger = ctx.logger.child({
      component: "listen_server",
    })

    const app = this.app = express();
    app.set("x-powered-by", false);
    app.httpAllowHalfOpen = true;
    app.useChunkedEncodingByDefault = false;
    app.use((req, res, next) => {
      res.set('Server', 'StreamMachine/MediaInbox');
      next();
    });
    app.use(cookieParser());

    if (get(config, 'cors.enabled')) {
      this.logger.debug("enable cors");
      app.use(cors({
        origin: config.cors.origin || true,
        methods: "GET,HEAD"
      }));
    }

    if (config.behind_proxy) {
      this.logger.debug("enable 'trust proxy' for express");
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
      app.use(bannedClientsMiddleware(this.config.ua_skip, this.logger))
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
      this.logger.debug(`listen request for ${req.stream.key} from ip ${req.ip}`);

      this.ctx.events.emit(Events.Listener.LANDED, {
        stream: req.stream,
        req,
        res,
      });
    });

    this.server = setupHttpServer({ app, ctx });
  }
};
