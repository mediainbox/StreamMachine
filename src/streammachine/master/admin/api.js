var BasicStrategy, MasterAPI, Throttle, Users, api, bodyParser, express, passport, path;

express = require("express");

bodyParser = require("body-parser");

api = require("express-api-helper");

path = require("path");

passport = require("passport");

BasicStrategy = (require("passport-http")).BasicStrategy;

Throttle = require("throttle");

Users = require("./users");

module.exports = MasterAPI = class MasterAPI {
  constructor(ctx) {
    var corsFunc;
    this.ctx = ctx;
    this.logger = this.ctx.logger.child({
      component: "api"
    });
    this.master = this.ctx.master;
    this.app = express();
    // -- set up authentication -- #
    this.users = new Users.Local(this.ctx);
    if (this.ctx.config.require_auth) {
      passport.use(new BasicStrategy((user, passwd, done) => {
        return this.users.validate(user, passwd, done);
      }));
      this.app.use(passport.initialize());
      this.app.use(passport.authenticate('basic', {
        session: false
      }));
    }
    // -- Param Handlers -- #
    this.app.param("stream", (req, res, next, key) => {
      var s, sg;
      // make sure it's a valid stream key
      if ((key != null) && (s = this.master.streams[key])) {
        req.stream = s;
        return next();
      } else if ((key != null) && (sg = this.master.stream_groups[key])) {
        req.stream = sg._stream;
        return next();
      } else {
        return res.status(404).end("Invalid stream.\n");
      }
    });
    this.app.param("mount", (req, res, next, key) => {
      var s;
      // make sure it's a valid source mount key
      if ((key != null) && (s = this.master.source_mounts[key])) {
        req.mount = s;
        return next();
      } else {
        return res.status(404).end("Invalid source mount.\n");
      }
    });
    // -- options support for CORS -- #
    corsFunc = (req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Credentials', true);
      res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      return next();
    };
    this.app.use(corsFunc);
    this.app.options("*", (req, res) => {
      return res.status(200).end("");
    });

    this.app.get('/help', (req, res) => {
      res.send(`
StreamMachine Master API
  Available endpoints:
    GET /listeners 
    GET /streams
      GET /streams/:stream
      GET /streams/:stream/config
    GET /sources
      GET /sources/:source/mount
      GET /sources/:source/config
    GET /config
    GET /slaves
    GET /users
      `);
    });

    // -- Routing -- #
    this.app.get("/listeners", (req, res) => {
      if (this.master.analytics) {
        return this.master.analytics.countListeners((err, listeners) => {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, listeners);
          }
        });
      } else {
        return api.invalid(req, res, "Analytics function is required by listeners endpoint.");
      }
    });
    // list streams
    this.app.get("/streams", (req, res) => {
      // return JSON version of the status for all streams
      return api.ok(req, res, this.master.streamsInfo());
    });
    // list stream groups
    this.app.get("/stream_groups", (req, res) => {
      // return JSON version of the status for all streams
      return api.ok(req, res, this.master.groupsInfo());
    });
    // list source mounts
    this.app.get("/sources", (req, res) => {
      return api.ok(req, res, this.master.sourcesInfo());
    });
    // list streams
    this.app.get("/config", (req, res) => {
      // return JSON version of the status for all streams
      return api.ok(req, res, this.master.config());
    });
    // list slaves
    this.app.get("/slaves", (req, res) => {
      return api.ok(req, res, this.master.slavesInfo());
    });
    // create a stream
    this.app.post("/streams", bodyParser.json(), (req, res) => {
      // add a new stream
      return this.master.createStream(req.body, (err, stream) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, stream);
        }
      });
    });
    // get stream details
    this.app.get("/streams/:stream", (req, res) => {
      // get detailed stream information
      return api.ok(req, res, req.stream.status());
    });
    // get stream configuration
    this.app.get("/streams/:stream/config", (req, res) => {
      return api.ok(req, res, req.stream.config());
    });
    // update stream metadata
    this.app.post("/streams/:stream/metadata", bodyParser.json(), (req, res) => {
      return req.stream.setMetadata(req.body || req.query, (err, meta) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, meta);
        }
      });
    });
    // Update a stream's configuration
    this.app.put("/streams/:stream/config", bodyParser.json(), (req, res) => {
      return this.master.updateStream(req.stream, req.body, (err, obj) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, obj);
        }
      });
    });
    // Delete a stream
    this.app.delete("/streams/:stream", (req, res) => {
      return this.master.removeStream(req.stream, (err, obj) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, obj);
        }
      });
    });
    // Dump a RewindBuffer
    this.app.get("/streams/:stream/rewind", (req, res) => {
      res.status(200).write('');
      return req.stream.getRewind((err, io) => {
        // long story... may be related to https://github.com/joyent/node/issues/6065
        // in any case, piping to /dev/null went too fast and crashed the server.
        // Throttling fixes it
        return io.pipe(new Throttle(100 * 1024 * 1024)).pipe(res);
      });
    });
    // Clear a Rewind Buffer
    this.app.delete("/streams/:stream/rewind", (req, res) => {
      return req.stream.rewind.resetRewind((err) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, req.stream.status());
        }
      });
    });
    // Inject a Rewind Buffer
    this.app.put("/streams/:stream/rewind", (req, res) => {
      return req.stream.rewind.loadBuffer(req, (err, info) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, info);
        }
      });
    });
    // -- Source Mount API -- #
    this.app.post("/sources", bodyParser.json(), (req, res) => {
      // add a new source mount
      return this.master.createMount(req.body, (err, mount) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, mount);
        }
      });
    });
    this.app.get("/sources/:mount", (req, res) => {
      return api.ok(req, res, req.mount.status());
    });
    this.app.get("/sources/:mount/config", (req, res) => {
      return api.ok(req, res, req.mount.config());
    });
    // Promote a source to live
    this.app.post("/sources/:mount/promote", (req, res) => {
      // promote a stream source to active
      // We'll just pass on the UUID and leave any logic to the stream
      return req.mount.promoteSource(req.query.uuid, (err, msg) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, msg);
        }
      });
    });
    // Drop a source
    this.app.post("/sources/:mount/drop", (req, res) => {
      return req.mount.dropSource(req.query.uuid, (err, msg) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, msg);
        }
      });
    });
    // Update a source's configuration
    this.app.put("/sources/:mount/config", bodyParser.json(), (req, res) => {
      return this.master.updateMount(req.mount, req.body, (err, obj) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, obj);
        }
      });
    });
    // Delete a stream
    this.app.delete("/sources/:mount", (req, res) => {
      return this.master.removeMount(req.mount, (err, obj) => {
        if (err) {
          return api.invalid(req, res, err.message);
        } else {
          return api.ok(req, res, obj);
        }
      });
    });
    // -- User Management -- #

    // get a list of users
    this.app.get("/users", (req, res) => {
      return this.users.list((err, users) => {
        var i, len, obj, u;
        if (err) {
          return api.serverError(req, res, err);
        } else {
          obj = [];
          for (i = 0, len = users.length; i < len; i++) {
            u = users[i];
            obj.push({
              user: u,
              id: u
            });
          }
          return api.ok(req, res, obj);
        }
      });
    });
    // create / update a user
    this.app.post("/users", bodyParser.json(), (req, res) => {
      return this.users.store(req.body.user, req.body.password, (err, status) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, {
            ok: true
          });
        }
      });
    });
    // delete a user
    this.app.delete("/users/:user", (req, res) => {
      return this.users.store(req.params.user, null, (err, status) => {
        if (err) {
          return api.invalid(req, res, err);
        } else {
          return api.ok(req, res, {
            ok: true
          });
        }
      });
    });
  }

};
