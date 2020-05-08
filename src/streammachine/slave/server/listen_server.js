const express = require('express');
const cors = require("cors");
const { EventEmitter } = require('events');
const bannedClientsMiddleware = require('./middlewares/banned_clients');
const rootStreamRewrite = require('./middlewares/root_stream');
const utilityController = require('./utility_controller');
const setupHttpServer = require('./http_server');
const { get } = require('lodash');
const { outputs } = require('../outputs');

module.exports = class ListenServer extends EventEmitter {
  constructor({ streams, ctx }) {
    super();

    this.ctx = ctx;
    this.streams = streams;
    const config = this.config = ctx.config;

    this.logger = ctx.logger.child({
      component: "listen_server",
    })

    this.app = express();
    this.app.set("x-powered-by", "StreamMachine");
    this.app.httpAllowHalfOpen = true;
    this.app.useChunkedEncodingByDefault = false;

    if (get(config, 'cors.enabled')) {
      this.logger.debug("enable cors");
      this.app.use(cors({
        origin: config.cors.origin || true,
        methods: "GET,HEAD"
      }));
    }

    if (config.behind_proxy) {
      this.logger.debug("enable 'trust proxy' for express");
      this.app.set("trust proxy", true);
    }

    // :stream parameter load and validation for requests
    this.app.param("stream", (req, res, next, key) => {
      const stream = this.streams.get(key);

      if (!stream) {
        return res.status(404).end("Invalid stream.\n");
        return;
      }

      /*
      FIXME
      if (this.isGeolockEnabled && this.isGeolocked(req, stream)) {
        if (s.opts.geolock.fallback) {
          return res.redirect(302, s.opts.geolock.fallback);
        } else {
          return res.status(403).end("Invalid Country.");
        }
      }
      */

      req.stream = stream;
      next();
    });

    // url rewriter for root route
    this.app.use(rootStreamRewrite(this.streams));

    // requests debug logger
    // TODO: like stackdriver
    if (this.config.debug_incoming_requests) {
    }

    // check user agent for banned clients
    if (this.config.ua_skip) {
      this.app.use(bannedClientsMiddleware(this.config.ua_skip, this.logger))
    }

    // utility routes
    this.app.get("/index.html", utilityController.index);
    this.app.get("/crossdomain.xml", utilityController.crossdomain);

    // listener routes for stream
    this.app.head("/:stream", (req, res) => {
      res.set("content-type", "audio/mpeg");
      return res.status(200).end();
    });

    // listen to the stream
    this.app.get("/:stream", (req, res) => {
      const HandlerOutput = outputs.find(output => {
        return output.canHandleRequest(req);
      });
      new HandlerOutput({
        stream: req.stream,
        req,
        res,
        ctx: this.ctx
      });
    });

    this.server = setupHttpServer({
      app: this.app,
      ctx: this.ctx,
    });
  }
};
