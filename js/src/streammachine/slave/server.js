var Server, _, compression, cors, express, fs, greenlock, http, maxmind, path, util, uuid;

express = require('express');

_ = require('underscore');

util = require('util');

fs = require('fs');

path = require('path');

uuid = require('node-uuid');

http = require("http");

compression = require("compression");

cors = require("cors");

maxmind = require("maxmind");

greenlock = require("greenlock-express");

module.exports = Server = class Server extends require('events').EventEmitter {
  constructor(opts1) {
    var banned, idx_match, origin, ref, ref1, ref2, ref3, ref4, ref5;
    super();
    this.opts = opts1;
    this.core = this.opts.core;
    this.logger = this.opts.logger;
    this.config = this.opts.config;
    // -- set up our express app -- #
    this.app = express();
    if ((ref = this.opts.config.cors) != null ? ref.enabled : void 0) {
      origin = this.opts.config.cors.origin || true;
      this.app.use(cors({
        origin: origin,
        methods: "GET,HEAD"
      }));
    }
    this.app.httpAllowHalfOpen = true;
    this.app.useChunkedEncodingByDefault = false;
    this.app.set("x-powered-by", "StreamMachine");
    // -- are we behind a geolock? -- #
    this.isGeolockEnabled = this.config.geolock && this.config.geolock.enabled;
    if (this.isGeolockEnabled) {
      this.logger.info("Enabling 'geolock' for streams");
      this.countryLookup = maxmind.open(this.config.geolock.config_file);
    }
    // -- are we behind a proxy? -- #
    if (this.config.behind_proxy) {
      this.logger.info("Enabling 'trust proxy' for Express.js");
      this.app.set("trust proxy", true);
    }
    // -- Set up sessions -- #
    if (((ref1 = this.config.session) != null ? ref1.secret : void 0) && ((ref2 = this.config.session) != null ? ref2.key : void 0)) {
      this.app.use(express.cookieParser());
      this.app.use(express.cookieSession({
        key: (ref3 = this.config.session) != null ? ref3.key : void 0,
        secret: (ref4 = this.config.session) != null ? ref4.secret : void 0
      }));
      this.app.use((req, res, next) => {
        if (!req.session.userID) {
          req.session.userID = uuid.v4();
        }
        req.user_id = req.session.userID;
        return next();
      });
    }
    // -- Stream Finder -- #
    this.app.param("stream", (req, res, next, key) => {
      var s;
      // make sure it's a valid stream key
      if ((key != null) && (s = this.core.streams[key])) {
        if (this.isGeolockEnabled && this.isGeolocked(req, s, s.opts)) {
          if (s.opts.geolock.fallback) {
            return res.redirect(302, s.opts.geolock.fallback);
          } else {
            return res.status(403).end("Invalid Country.");
          }
        } else {
          req.stream = s;
          return next();
        }
      } else {
        return res.status(404).end("Invalid stream.\n");
      }
    });
    // -- Stream Group Finder -- #
    this.app.param("group", (req, res, next, key) => {
      var s;
      // make sure it's a valid stream key
      if ((key != null) && (s = this.core.stream_groups[key])) {
        req.group = s;
        return next();
      } else {
        return res.status(404).end("Invalid stream group.\n");
      }
    });
    // -- Funky URL Rewriters -- #
    this.app.use((req, res, next) => {
      if (this.core.root_route) {
        if (req.url === '/' || req.url === "/;stream.nsv" || req.url === "/;") {
          req.url = `/${this.core.root_route}`;
          return next();
        } else if (req.url === "/listen.pls") {
          req.url = `/${this.core.root_route}.pls`;
          return next();
        } else {
          return next();
        }
      } else {
        return next();
      }
    });
    // -- HLS Full Index Test -- #
    if ((ref5 = this.config.hls) != null ? ref5.limit_full_index : void 0) {
      idx_match = RegExp(`${this.config.hls.limit_full_index}`);
      this.app.use((req, res, next) => {
        var ref6, ua;
        ua = _.compact([req.query.ua, (ref6 = req.headers) != null ? ref6['user-agent'] : void 0]).join(" | ");
        if (idx_match.test(ua)) {

        } else {
          // do nothing...
          req.hls_limit = true;
        }
        return next();
      });
    }
    // -- Debug Logger -- #
    if (this.config.debug_incoming_requests) {
      this.app.use((req, res, next) => {
        var ref6;
        this.logger.debug(`Request: ${req.url}`, {
          ip: req.ip,
          ua: (ref6 = req.headers) != null ? ref6['user-agent'] : void 0
        });
        return next();
      });
    }
    // -- check user agent for banned clients -- #
    if (this.config.ua_skip) {
      banned = RegExp(`${this.config.ua_skip.join("|")}`);
      this.app.use((req, res, next) => {
        var ref6;
        if (!(((ref6 = req.headers) != null ? ref6['user-agent'] : void 0) && banned.test(req.headers["user-agent"]))) {
          return next();
        }
        // request from banned agent...
        this.logger.debug(`Request from banned User-Agent: ${req.headers['user-agent']}`, {
          ip: req.ip,
          url: req.url
        });
        return res.status(403).end("Invalid User Agent.");
      });
    }
    // -- Utility Routes -- #
    this.app.get("/index.html", (req, res) => {
      res.set("content-type", "text/html");
      res.set("connection", "close");
      return res.status(200).end(`<html>
    <head><title>StreamMachine</title></head>
    <body>
        <h1>OK</h1>
    </body>
</html>`);
    });
    this.app.get("/crossdomain.xml", (req, res) => {
      res.set("content-type", "text/xml");
      res.set("connection", "close");
      return res.status(200).end(`<?xml version="1.0"?>
<!DOCTYPE cross-domain-policy SYSTEM "http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd">
<cross-domain-policy>
<allow-access-from domain="*" />
</cross-domain-policy>`);
    });
    // -- Stream Routes -- #

    // playlist file
    this.app.get("/:stream.pls", (req, res) => {
      var host, ref6;
      res.set("content-type", "audio/x-scpls");
      res.set("connection", "close");
      host = ((ref6 = req.headers) != null ? ref6.host : void 0) || req.stream.options.host;
      return res.status(200).end(`[playlist]\nNumberOfEntries=1\nFile1=http://${host}/${req.stream.key}/\n`);
    });
    // -- HTTP Live Streaming -- #
    this.app.get("/sg/:group.m3u8", (req, res) => {
      return new this.core.Outputs.live_streaming.GroupIndex(req.group, {
        req: req,
        res: res
      });
    });
    this.app.get("/:stream.m3u8", compression({
      filter: function() {
        return true;
      }
    }), (req, res) => {
      return new this.core.Outputs.live_streaming.Index(req.stream, {
        req: req,
        res: res
      });
    });
    this.app.get("/:stream/ts/:seg.(:format)", (req, res) => {
      return new this.core.Outputs.live_streaming(req.stream, {
        req: req,
        res: res,
        format: req.params.format
      });
    });
    // head request
    this.app.head("/:stream", (req, res) => {
      res.set("content-type", "audio/mpeg");
      return res.status(200).end();
    });
    // listen to the stream
    this.app.get("/:stream", (req, res) => {
      res.set("X-Powered-By", "StreamMachine");
      // -- Stream match! -- #
      if (req.query.pump) {
        // pump listener pushes from the buffer as fast as possible
        return new this.core.Outputs.pumper(req.stream, {
          req: req,
          res: res
        });
      } else {
        // normal live stream (with or without shoutcast)
        if (req.headers['icy-metadata']) {
          // -- shoutcast listener -- #
          return new this.core.Outputs.shoutcast(req.stream, {
            req: req,
            res: res
          });
        } else {
          // -- straight mp3 listener -- #
          return new this.core.Outputs.raw(req.stream, {
            req: req,
            res: res
          });
        }
      }
    });
    this._setupServer(this.app);
  }

  //----------
  isGeolocked(req, stream, opts) {
    var country, data, index, locked;
    locked = false;
    if (opts.geolock && opts.geolock.enabled) {
      data = this.countryLookup.get(req.ip);
      country = null;
      if (data && data.country) {
        country = data.country;
      }
      if (country && country.iso_code) {
        index = opts.geolock.countryCodes.indexOf(country.iso_code);
        if (opts.geolock.mode === "blacklist") {
          locked = index >= 0;
        } else {
          locked = index < 0;
        }
      }
      if (locked && country) {
        // request from invalid country...
        this.logger.debug(`Request from invalid country: ${country.names.es} (${country.iso_code})`, {
          ip: req.ip
        });
      }
    }
    return locked;
  }

  //----------
  listen(port, cb) {
    this.logger.info("SlaveWorker called listen");
    this.hserver = this.app.listen(port, () => {
      return typeof cb === "function" ? cb(this.hserver) : void 0;
    });
    return this.hserver;
  }

  //----------
  close() {
    var ref;
    this.logger.info("Slave server asked to stop listening.");
    return (ref = this.hserver) != null ? ref.close(() => {
      return this.logger.info("Slave server listening stopped.");
    }) : void 0;
  }

  //----------
  _setupServer(app) {
    var packageRoot, server;
    if (process.env.NO_GREENLOCK) {
      this.logger.info("Setup http server on port " + this.config.http_port);
      server = http.createServer(app);
      return server.listen(this.config.http_port || 80);
    } else {
      this.logger.info("Setup Greenlock http/https servers");
      packageRoot = path.resolve(__dirname, '../../../..');
      return greenlock.init({
        packageRoot,
        configDir: "./greenlock.d",
        cluster: true,
        workers: 4,
        maintainerEmail: "contact@mediainbox.io"
      }).ready((glx) => {
        var plainAddr, plainPort, plainServer;
        plainServer = glx.httpServer(app);
        plainAddr = this.config.http_ip || '0.0.0.0';
        plainPort = this.config.http_port || 80;
        return plainServer.listen(plainPort, plainAddr, function() {
          var secureAddr, securePort, secureServer;
          secureServer = glx.httpsServer(null, app);
          secureAddr = this.config.https_ip || '0.0.0.0';
          securePort = this.config.https_port || 443;
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
  }

};

//# sourceMappingURL=server.js.map
