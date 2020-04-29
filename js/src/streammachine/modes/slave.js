var CP, Logger, RPC, Slave, SlaveMode, debug, greenlock, http, nconf, net, path, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require("underscore");

nconf = require("nconf");

path = require("path");

RPC = require("ipc-rpc");

net = require("net");

http = require("http");

CP = require("child_process");

greenlock = require("greenlock-express");

Logger = require("../logger");

Slave = require("../slave");

debug = require("debug")("sm:modes:slave");

module.exports = SlaveMode = (function(_super) {
  __extends(SlaveMode, _super);

  SlaveMode.prototype.MODE = "Slave";

  function SlaveMode(opts, cb) {
    this.opts = opts;
    this.log = (new Logger(this.opts.log)).child({
      mode: 'slave',
      pid: process.pid
    });
    this.log.debug("Slave Instance initialized");
    debug("Slave Mode init");
    process.title = "StreamM:slave";
    SlaveMode.__super__.constructor.apply(this, arguments);
    this._handle = null;
    this._haveHandle = false;
    this._shuttingDown = false;
    this._inHandoff = false;
    this._lastAddress = null;
    this._initFull = false;
    if (process.send != null) {
      debug("Setting up RPC");
      this._rpc = new RPC(process, {
        timeout: 5000,
        functions: {
          OK: function(msg, handle, cb) {
            return cb(null, "OK");
          },
          slave_port: (function(_this) {
            return function(msg, handle, cb) {
              return cb(null, _this.slavePort());
            };
          })(this),
          workers: (function(_this) {
            return function(msg, handle, cb) {};
          })(this),
          stream_listener: (function(_this) {
            return function(msg, handle, cb) {
              return _this._landListener(null, msg, handle, cb);
            };
          })(this),
          ready: (function(_this) {
            return function(msg, handle, cb) {
              return _this.pool.once_loaded(cb);
            };
          })(this),
          status: (function(_this) {
            return function(msg, handle, cb) {
              return _this.status(cb);
            };
          })(this)
        }
      });
    }
    this.pool = new SlaveMode.WorkerPool(this, this.opts.cluster, this.opts);
    this.pool.on("full_strength", (function(_this) {
      return function() {
        return _this.emit("full_strength");
      };
    })(this));
    process.on("SIGTERM", (function(_this) {
      return function() {
        return _this.pool.shutdown(function(err) {
          _this.log.info("Pool destroyed.");
          return process.exit();
        });
      };
    })(this));
    if (nconf.get("handoff")) {
      this._acceptHandoff(cb);
    } else {
      this._openServer(null, cb);
    }
  }

  SlaveMode.prototype.slavePort = function() {
    var _ref;
    return (_ref = this._server) != null ? _ref.address().port : void 0;
  };

  SlaveMode.prototype._openServer = function(handle, cb) {
    return this._createServer((function(_this) {
      return function(server, fallbackHttpServer) {
        _this._server = server;
        return _this._server.listen(handle || _this.opts.port, function(err) {
          if (err) {
            _this.log.error("Failed to start slave server: " + err);
            throw err;
          }
          _this._server.on("connection", function(conn) {
            conn.pause();
            return _this._distributeConnection(conn);
          });
          _this.log.info("Slave server is up and listening.");
          if (typeof cb === "function") {
            cb(null, _this);
          }
          if (fallbackHttpServer) {
            fallbackHttpServer.on("connection", function(conn) {
              conn.pause();
              return _this._distributeConnection(conn);
            });
            return _this.log.info("Slave fallback http server is up and listening.");
          }
        });
      };
    })(this));
  };

  SlaveMode.prototype._createServer = function(cb) {
    var packageRoot;
    if (process.env.NO_GREENLOCK) {
      return cb(http.createServer());
    } else {
      packageRoot = path.resolve(__dirname, '../../../..');
      return greenlock.init({
        packageRoot: packageRoot,
        configDir: "./greenlock.d",
        cluster: false,
        maintainerEmail: "contact@mediainbox.io"
      }).ready((function(_this) {
        return function(servers) {
          var plainServer, secureServer;
          plainServer = servers.httpServer(function(req, res, next) {
            console.log('Fallback http handling connection');
            return next();
          });
          secureServer = servers.httpsServer();
          return plainServer.listen(80, function() {
            return cb(secureServer, plainServer);
          });
        };
      })(this));
    }
  };

  SlaveMode.prototype._distributeConnection = function(conn) {
    var w;
    w = this.pool.getWorker();
    if (!w) {
      this.log.debug("Listener arrived before any ready workers. Waiting.");
      this.pool.once("worker_loaded", (function(_this) {
        return function() {
          _this.log.debug("Distributing listener now that worker is ready.");
          return _this._distributeConnection(conn);
        };
      })(this));
      return;
    }
    this.log.silly("Distributing listener to worker " + w.id + " (" + w.pid + ")");
    return w.rpc.request("connection", null, conn, (function(_this) {
      return function(err) {
        if (err) {
          _this.log.error("Failed to land incoming connection: " + err);
          return conn.destroy();
        }
      };
    })(this));
  };

  SlaveMode.prototype.shutdownWorker = function(id, cb) {
    return this.pool.shutdownWorker(id, cb);
  };

  SlaveMode.prototype.status = function(cb) {
    return this.pool.status(cb);
  };

  SlaveMode.prototype._listenerFromWorker = function(id, msg, handle, cb) {
    this.log.debug("Landing listener from worker.", {
      inHandoff: this._inHandoff
    });
    if (this._inHandoff) {
      return this._inHandoff.request("stream_listener", msg, handle, (function(_this) {
        return function(err) {
          return cb(err);
        };
      })(this));
    } else {
      return this._landListener(id, msg, handle, cb);
    }
  };

  SlaveMode.prototype._landListener = function(sender, obj, handle, cb) {
    var w;
    w = this.pool.getWorker(sender);
    if (w) {
      this.log.debug("Asking to land listener on worker " + w.id);
      return w.rpc.request("land_listener", obj, handle, (function(_this) {
        return function(err) {
          return cb(err);
        };
      })(this));
    } else {
      this.log.debug("No worker ready to land listener!");
      return cb("No workers ready to receive listeners.");
    }
  };

  SlaveMode.prototype._sendHandoff = function(rpc) {
    var _ref;
    this.log.info("Starting slave handoff.");
    this._shuttingDown = true;
    this._inHandoff = rpc;
    return rpc.request("server_socket", {}, (_ref = this._server) != null ? _ref._handle : void 0, (function(_this) {
      return function(err) {
        if (err) {
          _this.log.error("Error sending socket across handoff: " + err);
        }
        _this.log.info("Server socket transferred. Sending listener connections.");
        return _this.pool.shutdown(function(err) {
          _this.log.event("Sent slave data to new process. Exiting.");
          return process.exit();
        });
      };
    })(this));
  };

  SlaveMode.prototype._acceptHandoff = function(cb) {
    this.log.info("Initializing handoff receptor.");
    if (!this._rpc) {
      this.log.error("Handoff called, but no RPC interface set up. Aborting.");
      return false;
    }
    this._rpc.once("HANDOFF_GO", (function(_this) {
      return function(msg, handle, hgcb) {
        _this._rpc.once("server_socket", function(msg, handle, sscb) {
          var _go;
          _this.log.info("Incoming server handle.");
          _this._openServer(handle, function(err) {
            if (err) {
              _this.log.error("Failed to start server using transferred handle.");
              return false;
            }
            return _this.log.info("Server started with handle received during handoff.");
          });
          _go = function() {
            sscb(null);
            return typeof cb === "function" ? cb(null) : void 0;
          };
          if (_this._initFull) {
            return _go();
          } else {
            return _this.once("full_strength", function() {
              return _go();
            });
          }
        });
        return hgcb(null, "GO");
      };
    })(this));
    if (process.send == null) {
      this.log.error("Handoff called, but process has no send function. Aborting.");
      return false;
    }
    return process.send("HANDOFF_GO");
  };

  SlaveMode.WorkerPool = (function(_super1) {
    __extends(WorkerPool, _super1);

    function WorkerPool(s, size, config) {
      this.s = s;
      this.size = size;
      this.config = config;
      this.workers = {};
      this._shutdown = false;
      debug("Worker pool init with size of " + this.size + ".");
      this.log = this.s.log.child({
        component: "worker_pool"
      });
      this._nextId = 1;
      this._spawn();
      this._statusPoll = setInterval((function(_this) {
        return function() {
          var w, _i, _len, _ref, _results;
          _ref = _this.workers;
          _results = [];
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            w = _ref[_i];
            _results.push((function(w) {
              if (!w.rpc) {
                return;
              }
              return w.rpc.request("status", function(err, s) {
                if (err) {
                  _this.log.error("Worker status error: " + err);
                }
                return w.status = {
                  id: id,
                  listening: w._listening,
                  loaded: w._loaded,
                  streams: s,
                  pid: w.pid,
                  ts: Number(new Date)
                };
              });
            })(w));
          }
          return _results;
        };
      })(this), 1000);
      process.on("exit", (function(_this) {
        return function() {
          var id, w, _ref, _results;
          _ref = _this.workers;
          _results = [];
          for (id in _ref) {
            w = _ref[id];
            _results.push(w.w.kill());
          }
          return _results;
        };
      })(this));
    }

    WorkerPool.prototype._spawn = function() {
      var id, p, w;
      if (this.count() >= this.size) {
        debug("Pool is now at " + (this.count()) + ". Full strength.");
        this.log.debug("Pool is at full strength");
        this.emit("full_strength");
        return false;
      }
      id = this._nextId;
      this._nextId += 1;
      debug("Spawning worker " + id + ".");
      p = CP.fork(path.resolve(__dirname, "./slave_worker.js"));
      debug("Worker " + id + " forked with pid of " + p.pid);
      this.log.debug("Spawning new worker.", {
        count: this.count(),
        target: this.size
      });
      w = new SlaveMode.Worker({
        id: id,
        w: p,
        rpc: null,
        pid: p.pid,
        status: null,
        _loaded: false,
        _config: false
      });
      w.rpc = new RPC(p, {
        functions: {
          worker_configured: (function(_this) {
            return function(msg, handle, cb) {
              _this.log.debug("Worker " + w.id + " is configured.");
              w._config = true;
              return cb(null);
            };
          })(this),
          rewinds_loaded: (function(_this) {
            return function(msg, handle, cb) {
              _this.log.debug("Worker " + w.id + " is loaded.");
              w._loaded = true;
              _this.emit("worker_loaded");
              cb(null);
              debug("Worker " + w.id + " rewind loaded. Attempting new spawn.");
              return _this._spawn();
            };
          })(this),
          send_listener: (function(_this) {
            return function(msg, handle, cb) {
              return _this.s._listenerFromWorker(w.id, msg, handle, cb);
            };
          })(this),
          config: (function(_this) {
            return function(msg, handle, cb) {
              return cb(null, _this.config);
            };
          })(this)
        }
      }, (function(_this) {
        return function(err) {
          if (err) {
            _this.log.error("Error setting up RPC for new worker: " + err);
            worker.kill();
            return false;
          }
          _this.log.debug("Worker " + w.id + " is set up.", {
            id: w.id,
            pid: w.pid
          });
          debug("Worker " + w.id + " RPC is set up.");
          return _this.workers[w.id] = w;
        };
      })(this));
      p.once("exit", (function(_this) {
        return function() {
          debug("Got exit from worker process " + w.id);
          _this.log.info("SlaveWorker exit: " + w.id);
          delete _this.workers[w.id];
          w.emit("exit");
          w.destroy();
          if (!_this._shutdown) {
            return _this._spawn();
          }
        };
      })(this));
      return p.on("error", (function(_this) {
        return function(err) {
          debug("Error from worker process " + w.id + ": " + err);
          return _this.log.error("Error from SlaveWorker process: " + err);
        };
      })(this));
    };

    WorkerPool.prototype.count = function() {
      return Object.keys(this.workers).length;
    };

    WorkerPool.prototype.loaded_count = function() {
      return _(this.workers).select(function(w) {
        return w._loaded;
      }).length;
    };

    WorkerPool.prototype.once_loaded = function(cb) {
      if (this.loaded_count() === 0) {
        return this.once("worker_loaded", (function(_this) {
          return function() {
            return cb(null);
          };
        })(this));
      } else {
        return cb(null);
      }
    };

    WorkerPool.prototype.shutdown = function(cb) {
      var af, id, w, _ref, _results;
      this._shutdown = true;
      this.log.info("Slave WorkerPool is exiting.");
      if (this.count() === 0) {
        clearInterval(this._statusPoll);
        cb(null);
      }
      af = _.after(this.count(), (function(_this) {
        return function() {
          clearInterval(_this._statusPoll);
          return cb(null);
        };
      })(this));
      _ref = this.workers;
      _results = [];
      for (id in _ref) {
        w = _ref[id];
        _results.push(this.shutdownWorker(id, (function(_this) {
          return function(err) {
            return af();
          };
        })(this)));
      }
      return _results;
    };

    WorkerPool.prototype.shutdownWorker = function(id, cb) {
      if (!this.workers[id]) {
        if (typeof cb === "function") {
          cb("Cannot call shutdown: Worker id unknown");
        }
        return false;
      }
      this.log.info("Sending shutdown to worker " + id);
      return this.workers[id].rpc.request("shutdown", {}, (function(_this) {
        return function(err) {
          var timer;
          if (err) {
            _this.log.error("Shutdown errored: " + err);
            return false;
          }
          cb = _.once(cb);
          timer = setTimeout(function() {
            _this.log.error("Failed to get worker exit before timeout. Trying kill.");
            w.w.kill();
            return timer = setTimeout(function() {
              return cb("Failed to shut down worker.");
            }, 500);
          }, 1000);
          return _this.workers[id].once("exit", function() {
            _this.log.info("Shutdown succeeded for worker " + id + ".");
            if (timer) {
              clearTimeout(timer);
            }
            return cb(null);
          });
        };
      })(this));
    };

    WorkerPool.prototype.getWorker = function(exclude_id) {
      var workers;
      workers = exclude_id ? _(this.workers).select(function(w) {
        return w._loaded && w.id !== exclude_id;
      }) : _(this.workers).select(function(w) {
        return w._loaded;
      });
      if (workers.length === 0) {
        return null;
      } else {
        return _.sample(workers);
      }
    };

    WorkerPool.prototype.status = function(cb) {
      var af, id, status, w, _ref, _results;
      status = {};
      af = _.after(Object.keys(this.workers).length, (function(_this) {
        return function() {
          return cb(null, status);
        };
      })(this));
      _ref = this.workers;
      _results = [];
      for (id in _ref) {
        w = _ref[id];
        _results.push((function(_this) {
          return function(id, w) {
            return w.rpc.request("status", function(err, s) {
              if (err) {
                _this.log.error("Worker status error: " + err);
              }
              status[id] = {
                id: id,
                listening: w._listening,
                loaded: w._loaded,
                streams: s,
                pid: w.pid
              };
              return af();
            });
          };
        })(this)(id, w));
      }
      return _results;
    };

    return WorkerPool;

  })(require("events").EventEmitter);

  SlaveMode.Worker = (function(_super1) {
    __extends(Worker, _super1);

    function Worker(attributes) {
      var k, v;
      for (k in attributes) {
        v = attributes[k];
        this[k] = v;
      }
    }

    Worker.prototype.destroy = function() {
      return this.removeAllListeners();
    };

    return Worker;

  })(require("events").EventEmitter);

  return SlaveMode;

})(require("./base"));

//# sourceMappingURL=slave.js.map
