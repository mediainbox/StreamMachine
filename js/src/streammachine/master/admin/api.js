var API, BasicStrategy, Throttle, Users, api, bodyParser, express, passport, path;

express = require("express");

bodyParser = require("body-parser");

api = require("express-api-helper");

path = require("path");

passport = require("passport");

BasicStrategy = (require("passport-http")).BasicStrategy;

Throttle = require("throttle");

Users = require("./users");

module.exports = API = (function() {
  function API(master, require_auth) {
    var corsFunc;
    this.master = master;
    if (require_auth == null) {
      require_auth = false;
    }
    this.log = this.master.log.child({
      component: "admin"
    });
    this.app = express();
    this.users = new Users.Local(this);
    if (require_auth) {
      passport.use(new BasicStrategy((function(_this) {
        return function(user, passwd, done) {
          return _this.users.validate(user, passwd, done);
        };
      })(this)));
      this.app.use(passport.initialize());
      this.app.use(passport.authenticate('basic', {
        session: false
      }));
    }
    this.app.param("stream", (function(_this) {
      return function(req, res, next, key) {
        var s, sg;
        if ((key != null) && (s = _this.master.streams[key])) {
          req.stream = s;
          return next();
        } else if ((key != null) && (sg = _this.master.stream_groups[key])) {
          req.stream = sg._stream;
          return next();
        } else {
          return res.status(404).end("Invalid stream.\n");
        }
      };
    })(this));
    this.app.param("mount", (function(_this) {
      return function(req, res, next, key) {
        var s;
        if ((key != null) && (s = _this.master.source_mounts[key])) {
          req.mount = s;
          return next();
        } else {
          return res.status(404).end("Invalid source mount.\n");
        }
      };
    })(this));
    corsFunc = (function(_this) {
      return function(req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Credentials', true);
        res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        return next();
      };
    })(this);
    this.app.use(corsFunc);
    this.app.options("*", (function(_this) {
      return function(req, res) {
        return res.status(200).end("");
      };
    })(this));
    this.app.get("/listeners", (function(_this) {
      return function(req, res) {
        if (_this.master.analytics) {
          return _this.master.analytics.countListeners(function(err, listeners) {
            if (err) {
              return api.invalid(req, res, err);
            } else {
              return api.ok(req, res, listeners);
            }
          });
        } else {
          return api.invalid(req, res, "Analytics function is required by listeners endpoint.");
        }
      };
    })(this));
    this.app.get("/streams", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, _this.master.streamsInfo());
      };
    })(this));
    this.app.get("/stream_groups", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, _this.master.groupsInfo());
      };
    })(this));
    this.app.get("/sources", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, _this.master.sourcesInfo());
      };
    })(this));
    this.app.get("/config", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, _this.master.config());
      };
    })(this));
    this.app.get("/slaves", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, _this.master.slavesInfo());
      };
    })(this));
    this.app.post("/streams", express.bodyParser(), (function(_this) {
      return function(req, res) {
        return _this.master.createStream(req.body, function(err, stream) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, stream);
          }
        });
      };
    })(this));
    this.app.get("/streams/:stream", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, req.stream.status());
      };
    })(this));
    this.app.get("/streams/:stream/config", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, req.stream.config());
      };
    })(this));
    this.app.post("/streams/:stream/metadata", express.bodyParser(), (function(_this) {
      return function(req, res) {
        return req.stream.setMetadata(req.body || req.query, function(err, meta) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, meta);
          }
        });
      };
    })(this));
    this.app.put("/streams/:stream/config", express.bodyParser(), (function(_this) {
      return function(req, res) {
        return _this.master.updateStream(req.stream, req.body, function(err, obj) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, obj);
          }
        });
      };
    })(this));
    this.app["delete"]("/streams/:stream", (function(_this) {
      return function(req, res) {
        return _this.master.removeStream(req.stream, function(err, obj) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, obj);
          }
        });
      };
    })(this));
    this.app.get("/streams/:stream/rewind", (function(_this) {
      return function(req, res) {
        res.status(200).write('');
        return req.stream.getRewind(function(err, io) {
          return io.pipe(new Throttle(100 * 1024 * 1024)).pipe(res);
        });
      };
    })(this));
    this.app["delete"]("/streams/:stream/rewind", (function(_this) {
      return function(req, res) {
        return req.stream.rewind.resetRewind(function(err) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, req.stream.status());
          }
        });
      };
    })(this));
    this.app.put("/streams/:stream/rewind", (function(_this) {
      return function(req, res) {
        return req.stream.rewind.loadBuffer(req, function(err, info) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, info);
          }
        });
      };
    })(this));
    this.app.post("/sources", express.bodyParser(), (function(_this) {
      return function(req, res) {
        return _this.master.createMount(req.body, function(err, mount) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, mount);
          }
        });
      };
    })(this));
    this.app.get("/sources/:mount", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, req.mount.status());
      };
    })(this));
    this.app.get("/sources/:mount/config", (function(_this) {
      return function(req, res) {
        return api.ok(req, res, req.mount.config());
      };
    })(this));
    this.app.post("/sources/:mount/promote", (function(_this) {
      return function(req, res) {
        return req.mount.promoteSource(req.query.uuid, function(err, msg) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, msg);
          }
        });
      };
    })(this));
    this.app.post("/sources/:mount/drop", (function(_this) {
      return function(req, res) {
        return req.mount.dropSource(req.query.uuid, function(err, msg) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, msg);
          }
        });
      };
    })(this));
    this.app.put("/sources/:mount/config", express.bodyParser(), (function(_this) {
      return function(req, res) {
        return _this.master.updateMount(req.mount, req.body, function(err, obj) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, obj);
          }
        });
      };
    })(this));
    this.app["delete"]("/sources/:mount", (function(_this) {
      return function(req, res) {
        return _this.master.removeMount(req.mount, function(err, obj) {
          if (err) {
            return api.invalid(req, res, err.message);
          } else {
            return api.ok(req, res, obj);
          }
        });
      };
    })(this));
    this.app.get("/users", (function(_this) {
      return function(req, res) {
        return _this.users.list(function(err, users) {
          var obj, u, _i, _len;
          if (err) {
            return api.serverError(req, res, err);
          } else {
            obj = [];
            for (_i = 0, _len = users.length; _i < _len; _i++) {
              u = users[_i];
              obj.push({
                user: u,
                id: u
              });
            }
            return api.ok(req, res, obj);
          }
        });
      };
    })(this));
    this.app.post("/users", express.bodyParser(), (function(_this) {
      return function(req, res) {
        return _this.users.store(req.body.user, req.body.password, function(err, status) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, {
              ok: true
            });
          }
        });
      };
    })(this));
    this.app["delete"]("/users/:user", (function(_this) {
      return function(req, res) {
        return _this.users.store(req.params.user, null, function(err, status) {
          if (err) {
            return api.invalid(req, res, err);
          } else {
            return api.ok(req, res, {
              ok: true
            });
          }
        });
      };
    })(this));
  }

  return API;

})();

//# sourceMappingURL=api.js.map
