var CP, RPC, Slave, Worker, WorkerPool, debug, path, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require("underscore");

path = require("path");

RPC = require("ipc-rpc");

CP = require("child_process");

Slave = require("../slave");

debug = require("debug")("sm:modes:slave");

module.exports = WorkerPool = (function(_super) {
  __extends(WorkerPool, _super);

  function WorkerPool(slave, size, config) {
    this.slave = slave;
    this.size = size;
    this.config = config;
    this.workers = {};
    this._shutdown = false;
    debug("Worker pool init with size of " + this.size + ".");
    this.log = this.slave.log.child({
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
    w = new Worker({
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
            return _this.slave._listenerFromWorker(w.id, msg, handle, cb);
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

Worker = (function(_super) {
  __extends(Worker, _super);

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

//# sourceMappingURL=worker_pool.js.map
