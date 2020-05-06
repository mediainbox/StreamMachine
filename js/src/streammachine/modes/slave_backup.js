var CP, Logger, RPC, Slave, SlaveMode, _, debug, nconf, net, path;

_ = require("underscore");

nconf = require("nconf");

path = require("path");

RPC = require("ipc-rpc");

net = require("net");

CP = require("child_process");

Logger = require("../logger");

Slave = require("../slave");

debug = require("debug")("sm:modes:slave");

//----------
module.exports = SlaveMode = (function() {
  class SlaveMode extends require("./base_mode") {
    constructor(opts, cb) {
      super();
      this.opts = opts;
      this.log = (new Logger(this.opts.log)).child({
        mode: 'slave',
        pid: process.pid
      });
      this.log.debug("Slave Instance initialized");
      debug("Slave Mode init");
      process.title = "StreamM:slave";
      this._handle = null;
      this._haveHandle = false;
      this._shuttingDown = false;
      this._inHandoff = false;
      this._lastAddress = null;
      this._initFull = false;
      // -- Set up Internal RPC -- #
      if (process.send != null) {
        debug("Setting up RPC");
        this._rpc = new RPC(process, {
          timeout: 5000,
          functions: {
            OK: function(msg, handle, cb) {
              return cb(null, "OK");
            },
            slave_port: (msg, handle, cb) => {
              return cb(null, this.slavePort());
            },
            //---
            workers: (msg, handle, cb) => {},
            //---
            stream_listener: (msg, handle, cb) => {
              return this._landListener(null, msg, handle, cb);
            },
            //---
            ready: (msg, handle, cb) => {
              // We're "ready" once we have one loaded worker
              return this.pool.once_loaded(cb);
            },
            //---
            status: (msg, handle, cb) => {
              return this.status(cb);
            }
          }
        });
      }
      // -- Set up Clustered Worker Pool -- #
      this.pool = new SlaveMode.WorkerPool(this, this.opts.cluster, this.opts);
      this.pool.on("full_strength", () => {
        return this.emit("full_strength");
      });
      process.on("SIGTERM", () => {
        return this.pool.shutdown((err) => {
          this.log.info("Pool destroyed.");
          return process.exit();
        });
      });
      // -- set up server -- #

      // We handle incoming connections here in the slave process, and then
      // distribute them to our ready workers.

      // If we're doing a handoff, we wait to receive a server handle from
      // the sending process. If not, we should go ahead and start a server
      // ourself.
      if (nconf.get("handoff")) {
        this._acceptHandoff(cb);
      } else {
        // we'll listen via our configured port
        this._openServer(null, cb);
      }
    }

    //----------
    slavePort() {
      var ref;
      return (ref = this._server) != null ? ref.address().port : void 0;
    }

    //----------
    _openServer(handle, cb) {
      this._server = net.createServer({
        pauseOnConnect: true,
        allowHalfOpen: true
      });
      return this._server.listen(handle || this.opts.port, (err) => {
        if (err) {
          this.log.error(`Failed to start slave server: ${err}`);
          throw err;
        }
        this._server.on("connection", (conn) => {
          // FIXME: This is nasty...
          // https://github.com/joyent/node/issues/7905
          if (/^v0.10/.test(process.version)) {
            conn._handle.readStop();
          }
          conn.pause();
          return this._distributeConnection(conn);
        });
        this.log.info("Slave server is up and listening.");
        return typeof cb === "function" ? cb(null, this) : void 0;
      });
    }

    //----------
    _distributeConnection(conn) {
      var w;
      w = this.pool.getWorker();
      if (!w) {
        this.log.debug("Listener arrived before any ready workers. Waiting.");
        this.pool.once("worker_loaded", () => {
          this.log.debug("Distributing listener now that worker is ready.");
          return this._distributeConnection(conn);
        });
        return;
      }
      this.log.debug(`Distributing listener to worker ${w.id} (${w.pid})`);
      return w.rpc.request("connection", null, conn, (err) => {
        if (err) {
          this.log.error(`Failed to land incoming connection: ${err}`);
          return conn.destroy();
        }
      });
    }

    //----------
    shutdownWorker(id, cb) {
      return this.pool.shutdownWorker(id, cb);
    }

    //----------
    status(cb) {
      // send back a status for each of our workers
      return this.pool.status(cb);
    }

    //----------
    _listenerFromWorker(id, msg, handle, cb) {
      this.log.debug("Landing listener from worker.", {
        inHandoff: this._inHandoff
      });
      if (this._inHandoff) {
        // we're in a handoff. ship the listener out there
        return this._inHandoff.request("stream_listener", msg, handle, (err) => {
          return cb(err);
        });
      } else {
        // we can hand the listener to any slave except the one
        // it came from
        return this._landListener(id, msg, handle, cb);
      }
    }

    //----------

      // Distribute a listener to one of our ready slave workers. This could be
    // an external request via handoff, or it could be an internal request from
    // a worker instance that is shutting down.
    _landListener(sender, obj, handle, cb) {
      var w;
      w = this.pool.getWorker(sender);
      if (w) {
        this.log.debug(`Asking to land listener on worker ${w.id}`);
        return w.rpc.request("land_listener", obj, handle, (err) => {
          return cb(err);
        });
      } else {
        this.log.debug("No worker ready to land listener!");
        return cb("No workers ready to receive listeners.");
      }
    }

    //----------
    _sendHandoff(rpc) {
      var ref;
      this.log.info("Starting slave handoff.");
      // don't try to spawn new workers
      this._shuttingDown = true;
      this._inHandoff = rpc;
      // Coordinate handing off our server handle
      return rpc.request("server_socket", {}, (ref = this._server) != null ? ref._handle : void 0, (err) => {
        if (err) {
          this.log.error(`Error sending socket across handoff: ${err}`);
        }
        // FIXME: Proceed? Cancel?
        this.log.info("Server socket transferred. Sending listener connections.");
        // Ask the pool to shut down its workers.
        return this.pool.shutdown((err) => {
          this.log.event("Sent slave data to new process. Exiting.");
          // Exit
          return process.exit();
        });
      });
    }

    //----------
    _acceptHandoff(cb) {
      this.log.info("Initializing handoff receptor.");
      if (!this._rpc) {
        this.log.error("Handoff called, but no RPC interface set up. Aborting.");
        return false;
      }
      this._rpc.once("HANDOFF_GO", (msg, handle, hgcb) => {
        this._rpc.once("server_socket", (msg, handle, sscb) => {
          var _go;
          this.log.info("Incoming server handle.");
          this._openServer(handle, (err) => {
            if (err) {
              // FIXME: How should we recover from this?
              this.log.error("Failed to start server using transferred handle.");
              return false;
            }
            return this.log.info("Server started with handle received during handoff.");
          });
          _go = () => {
            // let our sender know we're ready... we're already listening for
            // the stream_listener requests on our rpc, so our job in here is
            // done. The rest is on the sender.
            sscb(null);
            return typeof cb === "function" ? cb(null) : void 0;
          };
          // wait until we're at full strength to start transferring listeners
          if (this._initFull) {
            return _go();
          } else {
            return this.once("full_strength", () => {
              return _go();
            });
          }
        });
        return hgcb(null, "GO");
      });
      if (process.send == null) {
        this.log.error("Handoff called, but process has no send function. Aborting.");
        return false;
      }
      return process.send("HANDOFF_GO");
    }

  };

  SlaveMode.prototype.MODE = "Slave";

  //----------
  SlaveMode.WorkerPool = class WorkerPool extends require("events").EventEmitter {
    constructor(s1, size, config) {
      super();
      this.s = s1;
      this.size = size;
      this.config = config;
      this.workers = {};
      this._shutdown = false;
      debug(`Worker pool init with size of ${this.size}.`);
      this.log = this.s.log.child({
        component: "worker_pool"
      });
      this._nextId = 1;
      this._spawn();
      // poll each worker for its status every second
      this._statusPoll = setInterval(() => {
        var i, len, ref, results, w;
        ref = this.workers;
        results = [];
        for (i = 0, len = ref.length; i < len; i++) {
          w = ref[i];
          results.push(((w) => {
            if (!w.rpc) {
              return;
            }
            return w.rpc.request("status", (err, s) => {
              if (err) {
                this.log.error(`Worker status error: ${err}`);
              }
              return w.status = {
                id: id,
                listening: w._listening,
                loaded: w._loaded,
                streams: s,
                pid: w.pid,
                ts: Number(new Date())
              };
            });
          })(w));
        }
        return results;
      }, 1000);
      process.on("exit", () => {
        var id, ref, results, w;
        ref = this.workers;
        results = [];
        for (id in ref) {
          w = ref[id];
          // try one last effort to make sure workers are closed
          results.push(w.w.kill());
        }
        return results;
      });
    }

    //----------
    _spawn() {
      var id, p, w;
      if (this.count() >= this.size) {
        debug(`Pool is now at ${this.count()}. Full strength.`);
        this.log.debug("Pool is at full strength");
        this.emit("full_strength");
        return false;
      }
      id = this._nextId;
      this._nextId += 1;
      debug(`Spawning worker ${id}.`);
      p = CP.fork(path.resolve(__dirname, "./slave_worker.js"));
      debug(`Worker ${id} forked with pid of ${p.pid}`);
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
          // triggered by the worker once it has its streams configured
          // (though they may not yet have data to give out)
          worker_configured: (msg, handle, cb) => {
            this.log.debug(`Worker ${w.id} is configured.`);
            w._config = true;
            return cb(null);
          },
          //---

          // sent by the worker once its stream rewinds are loaded.
          // tells us that it's safe to trigger a new worker launch
          rewinds_loaded: (msg, handle, cb) => {
            this.log.debug(`Worker ${w.id} is loaded.`);
            w._loaded = true;
            this.emit("worker_loaded");
            // ACK
            cb(null);
            // now that we're done, see if any more workers need to start
            debug(`Worker ${w.id} rewind loaded. Attempting new spawn.`);
            return this._spawn();
          },
          //---

          // a worker is allowed to shed listeners at any point by
          // sending them here. This could be part of a handoff (where
          // we've asked for the listeners), or part of the worker
          // crashing / shutting down
          send_listener: (msg, handle, cb) => {
            return this.s._listenerFromWorker(w.id, msg, handle, cb);
          },
          //---

          // triggered by the worker to request configuration
          config: (msg, handle, cb) => {
            return cb(null, this.config);
          }
        }
      }, (err) => {
        if (err) {
          this.log.error(`Error setting up RPC for new worker: ${err}`);
          worker.kill();
          return false;
        }
        this.log.debug(`Worker ${w.id} is set up.`, {
          id: w.id,
          pid: w.pid
        });
        debug(`Worker ${w.id} RPC is set up.`);
        return this.workers[w.id] = w;
      });
      // -- Handle disconnects and exits -- #
      p.once("exit", () => {
        debug(`Got exit from worker process ${w.id}`);
        this.log.info(`SlaveWorker exit: ${w.id}`);
        delete this.workers[w.id];
        w.emit("exit");
        w.destroy();
        if (!this._shutdown) {
          return this._spawn();
        }
      });
      // error seems to be thrown for issues sending IPC
      return p.on("error", (err) => {
        debug(`Error from worker process ${w.id}: ${err}`);
        return this.log.error(`Error from SlaveWorker process: ${err}`);
      });
    }

    // FIXME: What else should we do?

      //----------
    count() {
      return Object.keys(this.workers).length;
    }

    //----------
    loaded_count() {
      return _(this.workers).select(function(w) {
        return w._loaded;
      }).length;
    }

    //----------
    once_loaded(cb) {
      if (this.loaded_count() === 0) {
        return this.once("worker_loaded", () => {
          return cb(null);
        });
      } else {
        return cb(null);
      }
    }

    //----------
    shutdown(cb) {
      var af, id, ref, results, w;
      this._shutdown = true;
      // send kill signals to all workers
      this.log.info("Slave WorkerPool is exiting.");
      if (this.count() === 0) {
        clearInterval(this._statusPoll);
        cb(null);
      }
      af = _.after(this.count(), () => {
        clearInterval(this._statusPoll);
        return cb(null);
      });
      ref = this.workers;
      results = [];
      for (id in ref) {
        w = ref[id];
        results.push(this.shutdownWorker(id, (err) => {
          return af();
        }));
      }
      return results;
    }

    //----------
    shutdownWorker(id, cb) {
      if (!this.workers[id]) {
        if (typeof cb === "function") {
          cb("Cannot call shutdown: Worker id unknown");
        }
        return false;
      }
      this.log.info(`Sending shutdown to worker ${id}`);
      return this.workers[id].rpc.request("shutdown", {}, (err) => {
        var timer;
        if (err) {
          this.log.error(`Shutdown errored: ${err}`);
          return false;
        }
        cb = _.once(cb);
        // set a shutdown timer
        timer = setTimeout(() => {
          this.log.error("Failed to get worker exit before timeout. Trying kill.");
          w.w.kill();
          return timer = setTimeout(() => {
            return cb("Failed to shut down worker.");
          }, 500);
        }, 1000);
        // now watch for the worker's exit event
        return this.workers[id].once("exit", () => {
          this.log.info(`Shutdown succeeded for worker ${id}.`);
          if (timer) {
            clearTimeout(timer);
          }
          return cb(null);
        });
      });
    }

    //----------
    getWorker(exclude_id) {
      var workers;
      // we want loaded workers, excluding the passed-in id if provided
      workers = exclude_id ? _(this.workers).select(function(w) {
        return w._loaded && w.id !== exclude_id;
      }) : _(this.workers).select(function(w) {
        return w._loaded;
      });
      if (workers.length === 0) {
        return null;
      } else {
        // From this pool of eligible workers, choose the one that seems
        // most appropriate to get new traffic.

        // FIXME: How about the one that has sent the least bytes?
        //return _.min workers, (w) -> w.status.bytes_sent
        return _.sample(workers);
      }
    }

    //----------
    status(cb) {
      var af, id, ref, results, status, w;
      status = {};
      af = _.after(Object.keys(this.workers).length, () => {
        return cb(null, status);
      });
      ref = this.workers;
      results = [];
      for (id in ref) {
        w = ref[id];
        results.push(((id, w) => {
          return w.rpc.request("status", (err, s) => {
            if (err) {
              this.log.error(`Worker status error: ${err}`);
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
        })(id, w));
      }
      return results;
    }

  };

  //----------
  SlaveMode.Worker = class Worker extends require("events").EventEmitter {
    constructor(attributes) {
      var k, v;
      super();
      for (k in attributes) {
        v = attributes[k];
        this[k] = v;
      }
    }

    destroy() {
      return this.removeAllListeners();
    }

  };

  return SlaveMode;

}).call(this);

//# sourceMappingURL=slave_backup.js.map
