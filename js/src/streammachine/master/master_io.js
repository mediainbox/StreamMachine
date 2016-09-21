var MasterIO, debug, nr, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

nr = require("newrelic");

_ = require("underscore");

debug = require("debug")("sm:master:master_io");

module.exports = MasterIO = (function(_super) {
  var Slave;

  __extends(MasterIO, _super);

  function MasterIO(master, log, opts) {
    var cUpdate;
    this.master = master;
    this.log = log;
    this.opts = opts;
    this.io = null;
    this.slaves = {};
    this._config = null;
    cUpdate = _.debounce((function(_this) {
      return function() {
        var config, id, s, _ref, _results;
        config = _this.master.config();
        _ref = _this.slaves;
        _results = [];
        for (id in _ref) {
          s = _ref[id];
          _this.log.debug("emit config to slave " + id);
          _results.push(s.sock.emit("config", config));
        }
        return _results;
      };
    })(this), 200);
    this.master.on("config_update", cUpdate);
  }

  MasterIO.prototype.updateConfig = function(config) {
    var id, s, _ref, _results;
    this._config = config;
    _ref = this.slaves;
    _results = [];
    for (id in _ref) {
      s = _ref[id];
      _results.push(s.sock.emit("config", config));
    }
    return _results;
  };

  MasterIO.prototype.listen = function(server) {
    this.io = require("socket.io").listen(server);
    this.log.info("Master now listening for slave connections.");
    this.io.use((function(_this) {
      return function(socket, next) {
        var _ref;
        debug("Authenticating slave connection.");
        if (_this.opts.password === ((_ref = socket.request._query) != null ? _ref.password : void 0)) {
          debug("Slave password is valid.");
          return next();
        } else {
          _this.log.debug("Slave password is incorrect.");
          debug("Slave password is incorrect.");
          return next(new Error("Invalid slave password."));
        }
      };
    })(this));
    return this.io.on("connection", (function(_this) {
      return function(sock) {
        debug("Master got connection");
        return sock.once("ok", nr.createWebTransaction("slave/ok", function(cb) {
          debug("Got OK from incoming slave connection at " + sock.id);
          cb("OK");
          _this.log.debug("slave connection is " + sock.id);
          if (_this._config) {
            sock.emit("config", _this._config);
          }
          _this.slaves[sock.id] = new Slave(_this, sock);
          _this.slaves[sock.id].on("disconnect", function() {
            delete _this.slaves[sock.id];
            return _this.emit("disconnect", sock.id);
          });
          return nr.endTransaction();
        }));
      };
    })(this));
  };

  MasterIO.prototype.broadcastHLSSnapshot = function(k, snapshot) {
    var id, s, _ref, _results;
    _ref = this.slaves;
    _results = [];
    for (id in _ref) {
      s = _ref[id];
      _results.push(s.sock.emit("hls_snapshot", {
        stream: k,
        snapshot: snapshot
      }));
    }
    return _results;
  };

  MasterIO.prototype.broadcastAudio = function(k, chunk) {
    var id, s, _ref, _results;
    _ref = this.slaves;
    _results = [];
    for (id in _ref) {
      s = _ref[id];
      _results.push(s.sock.emit("audio", {
        stream: k,
        chunk: chunk
      }));
    }
    return _results;
  };

  MasterIO.prototype.pollForSync = function(cb) {
    var af, obj, s, statuses, _ref, _results;
    statuses = [];
    cb = _.once(cb);
    af = _.after(Object.keys(this.slaves).length, (function(_this) {
      return function() {
        return cb(null, statuses);
      };
    })(this));
    _ref = this.slaves;
    _results = [];
    for (s in _ref) {
      obj = _ref[s];
      _results.push((function(_this) {
        return function(s, obj) {
          var pollTimeout, saf, sstat;
          saf = _.once(af);
          sstat = {
            id: obj.id,
            UNRESPONSIVE: false,
            ERROR: null,
            status: {}
          };
          statuses.push(sstat);
          pollTimeout = setTimeout(function() {
            _this.log.error("Slave " + s + " failed to respond to status.");
            sstat.UNRESPONSIVE = true;
            return saf();
          }, 1000);
          return obj.status(function(err, stat) {
            clearTimeout(pollTimeout);
            if (err) {
              _this.log.error("Slave " + s + " reported status error: " + err);
            }
            sstat.ERROR = err;
            sstat.status = stat;
            return saf();
          });
        };
      })(this)(s, obj));
    }
    return _results;
  };

  Slave = (function(_super1) {
    __extends(Slave, _super1);

    function Slave(sio, sock) {
      this.sio = sio;
      this.sock = sock;
      this.id = this.sock.id;
      this.last_status = null;
      this.last_err = null;
      this.connected_at = new Date();
      this.socklogger = this.sio.log.child({
        slave: this.sock.id
      });
      this.sock.on("log", (function(_this) {
        return function(obj) {
          if (obj == null) {
            obj = {};
          }
          return _this.socklogger[obj.level || 'debug'].apply(_this.socklogger, [obj.msg || "", obj.meta || {}]);
        };
      })(this));
      this.sock.on("vitals", (function(_this) {
        return function(key, cb) {
          return _this.sio.master.vitals(key, cb);
        };
      })(this));
      this.sock.on("hls_snapshot", (function(_this) {
        return function(key, cb) {
          return _this.sio.master.getHLSSnapshot(key, cb);
        };
      })(this));
      this.sock.on("disconnect", (function(_this) {
        return function() {
          return _this._handleDisconnect();
        };
      })(this));
    }

    Slave.prototype.status = function(cb) {
      return this.sock.emit("status", (function(_this) {
        return function(err, status) {
          _this.last_status = status;
          _this.last_err = err;
          return cb(err, status);
        };
      })(this));
    };

    Slave.prototype._handleDisconnect = function() {
      var connected;
      connected = Math.round((Number(new Date()) - Number(this.connected_at)) / 1000);
      this.sio.log.debug("Slave disconnect from " + this.sock.id + ". Connected for " + connected + " seconds.");
      return this.emit("disconnect");
    };

    return Slave;

  })(require("events").EventEmitter);

  return MasterIO;

})(require("events").EventEmitter);

//# sourceMappingURL=master_io.js.map
