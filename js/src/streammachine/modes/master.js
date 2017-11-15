var Logger, Master, MasterMode, RPC, debug, express, nconf, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require("underscore");

express = require("express");

nconf = require("nconf");

Logger = require("../logger");

Master = require("../master");

RPC = require("ipc-rpc");

debug = require("debug")("sm:modes:master");

module.exports = MasterMode = (function(_super) {
  __extends(MasterMode, _super);

  MasterMode.prototype.MODE = "Master";

  function MasterMode(opts, cb) {
    this.opts = opts;
    this.log = new Logger(_.extend(this.opts.log, nconf.get('log')));
    debug("Master instance initialized.");
    process.title = "StreamM:master";
    MasterMode.__super__.constructor.apply(this, arguments);
    this.master = new Master(_.extend({}, this.opts, {
      logger: this.log
    }));
    this.server = express();
    this.server.use("/s", this.master.transport.app);
    this.server.use("/api", this.master.api.app);
    if (process.send != null) {
      this._rpc = new RPC(process, {
        functions: {
          OK: function(msg, handle, cb) {
            return cb(null, "OK");
          },
          master_port: (function(_this) {
            return function(msg, handle, cb) {
              var _ref;
              return cb(null, ((_ref = _this.handle) != null ? _ref.address().port : void 0) || "NONE");
            };
          })(this),
          source_port: (function(_this) {
            return function(msg, handle, cb) {
              var _ref, _ref1;
              return cb(null, ((_ref = _this.master.sourcein) != null ? (_ref1 = _ref.server.address()) != null ? _ref1.port : void 0 : void 0) || "NONE");
            };
          })(this),
          config: (function(_this) {
            return function(config, handle, cb) {
              return _this.master.configure(config, function(err) {
                return cb(err, _this.master.config());
              });
            };
          })(this)
        }
      });
    }
    if (nconf.get("handoff")) {
      this._handoffStart(cb);
    } else {
      this._normalStart(cb);
    }
  }

  MasterMode.prototype._handoffStart = function(cb) {
    return this._acceptHandoff((function(_this) {
      return function(err) {
        if (err) {
          _this.log.error("_handoffStart Failed! Falling back to normal start: " + err);
          return _this._normalStart(cb);
        }
      };
    })(this));
  };

  MasterMode.prototype._normalStart = function(cb) {
    this.master.loadRewinds();
    this.handle = this.server.listen(this.opts.master.port);
    this.master.slaves.listen(this.handle);
    this.master.sourcein.listen();
    this.log.info("Listening.");
    return typeof cb === "function" ? cb(null, this) : void 0;
  };

  MasterMode.prototype._sendHandoff = function(rpc) {
    this.log.event("Got handoff signal from new process.");
    debug("In _sendHandoff. Waiting for config.");
    return rpc.once("configured", (function(_this) {
      return function(msg, handle, cb) {
        debug("Handoff recipient is configured. Syncing running config.");
        return rpc.request("config", _this.master.config(), function(err, streams) {
          if (err) {
            _this.log.error("Error setting config on new process: " + err);
            cb("Error sending config: " + err);
            return false;
          }
          _this.log.info("New Master confirmed configuration.");
          debug("New master confirmed configuration.");
          cb();
          debug("Calling sendHandoffData");
          return _this.master.sendHandoffData(rpc, function(err) {
            var _afterSockets;
            debug("Back in _sendHandoff. Sending listening sockets.");
            _this.log.event("Sent master data to new process.");
            _afterSockets = _.after(2, function() {
              debug("Socket transfer is done.");
              _this.log.info("Sockets transferred.  Exiting.");
              return process.exit();
            });
            _this.log.info("Hand off source socket.");
            rpc.request("source_socket", null, _this.master.sourcein.server, function(err) {
              if (err) {
                _this.log.error("Error sending source socket: " + err);
              }
              return _afterSockets();
            });
            _this.log.info("Hand off master socket.");
            return rpc.request("master_handle", null, _this.handle, function(err) {
              if (err) {
                _this.log.error("Error sending master handle: " + err);
              }
              return _afterSockets();
            });
          });
        });
      };
    })(this));
  };

  MasterMode.prototype._acceptHandoff = function(cb) {
    var handoff_timer;
    this.log.info("Initializing handoff receptor.");
    debug("In _acceptHandoff");
    if (!this._rpc) {
      cb(new Error("Handoff called, but no RPC interface set up."));
      return false;
    }
    handoff_timer = setTimeout((function(_this) {
      return function() {
        debug("Handoff failed to handshake. Done waiting.");
        return cb(new Error("Handoff failed to handshake within five seconds."));
      };
    })(this), 5000);
    debug("Waiting for HANDOFF_GO");
    return this._rpc.once("HANDOFF_GO", (function(_this) {
      return function(msg, handle, ccb) {
        clearTimeout(handoff_timer);
        debug("HANDOFF_GO received.");
        ccb(null, "GO");
        debug("Waiting for internal configuration signal.");
        return _this.master.once_configured(function() {
          debug("Telling handoff sender that we're configured.");
          return _this._rpc.request("configured", _this.master.config(), function(err, reply) {
            var aFunc;
            if (err) {
              _this.log.error("Failed to send config broadcast when starting handoff: " + err);
              return false;
            }
            debug("Handoff sender ACKed config.");
            _this.log.info("Handoff initiator ACKed our config broadcast.");
            _this.master.loadHandoffData(_this._rpc, function() {
              return _this.log.info("Handoff receiver believes all stream and source data has arrived.");
            });
            aFunc = _.after(2, function() {
              _this.log.info("Source and Master handles are up.");
              return typeof cb === "function" ? cb(null, _this) : void 0;
            });
            _this._rpc.once("source_socket", function(msg, handle, cb) {
              _this.log.info("Source socket is incoming.");
              _this.master.sourcein.listen(handle);
              cb(null);
              return aFunc();
            });
            return _this._rpc.once("master_handle", function(msg, handle, cb) {
              var _ref;
              _this.log.info("Master socket is incoming.");
              _this.handle = _this.server.listen(handle);
              if ((_ref = _this.master.slaves) != null) {
                _ref.listen(_this.handle);
              }
              cb(null);
              return aFunc();
            });
          });
        });
      };
    })(this));
  };

  return MasterMode;

})(require("./base"));

//# sourceMappingURL=master.js.map
