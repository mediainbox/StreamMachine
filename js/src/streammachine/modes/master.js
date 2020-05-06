var Logger, Master, MasterMode, RPC, _, debug, express, nconf;

_ = require("underscore");

express = require("express");

nconf = require("nconf");

RPC = require("ipc-rpc");

Logger = require("../logger");

Master = require("../master");

debug = require("debug")("sm:modes:master");

// Master Server

// Masters don't take client connections directly. They take incoming
// source streams and proxy them to the slaves, providing an admin
// interface and a point to consolidate logs and listener counts.
module.exports = MasterMode = (function() {
  class MasterMode extends require("./base_mode") {
    constructor(config, cb) {
      super(config);
      process.title = "SM:MASTER";
      this.logger.debug("Master mode starting");
      // create a master
      this.master = new Master(this.ctx);
      // Set up a server for our admin
      this.server = express();
      this.server.use("/s", this.master.transport.app);
      this.server.use("/api", this.master.api.app);
      if (process.send != null) {
        this._rpc = new RPC(process, {
          functions: {
            OK: function(msg, handle, cb) {
              return cb(null, "OK");
            },
            master_port: (msg, handle, cb) => {
              var ref;
              return cb(null, ((ref = this.handle) != null ? ref.address().port : void 0) || "NONE");
            },
            source_port: (msg, handle, cb) => {
              var ref, ref1;
              return cb(null, ((ref = this.master.sourcein) != null ? (ref1 = ref.server.address()) != null ? ref1.port : void 0 : void 0) || "NONE");
            },
            config: (config, handle, cb) => {
              return this.master.configure(config, (err) => {
                return cb(err, this.master.config());
              });
            }
          }
        });
      }
      //start_handoff: (msg,handle,cb) =>
      //    @_sendHandoff()
      //    cb null, "OK"
      if (nconf.get("handoff")) {
        this._handoffStart(cb);
      } else {
        this._normalStart(cb);
      }
    }

    //----------
    _handoffStart(cb) {
      return this._acceptHandoff((err) => {
        if (err) {
          this.logger.error(`_handoffStart Failed! Falling back to normal start: ${err}`);
          return this._normalStart(cb);
        }
      });
    }

    //----------
    _normalStart(cb) {
      // load any rewind buffers from disk
      this.master.loadRewinds();
      this.handle = this.server.listen(this.ctx.config.master.port);
      this.master.slaves.listen(this.handle);
      this.master.sourcein.listen();
      this.logger.info("Listening.");
      return typeof cb === "function" ? cb(null, this) : void 0;
    }

    //----------
    _sendHandoff(rpc) {
      this.logger.info("Got handoff signal from new process.");
      debug("In _sendHandoff. Waiting for config.");
      return rpc.once("configured", (msg, handle, cb) => {
        debug("Handoff recipient is configured. Syncing running config.");
        // send stream/source info so we make sure our configs are matched
        return rpc.request("config", this.master.config(), (err, streams) => {
          if (err) {
            this.logger.error(`Error setting config on new process: ${err}`);
            cb(`Error sending config: ${err}`);
            return false;
          }
          this.logger.info("New Master confirmed configuration.");
          debug("New master confirmed configuration.");
          // basically we leave the config request open while we send streams
          cb();
          // Send master data (includes source port handoff)
          debug("Calling sendHandoffData");
          return this.master.sendHandoffData(rpc, (err) => {
            var _afterSockets;
            debug("Back in _sendHandoff. Sending listening sockets.");
            this.logger.info("Sent master data to new process.");
            _afterSockets = _.after(2, () => {
              debug("Socket transfer is done.");
              this.logger.info("Sockets transferred.  Exiting.");
              return process.exit();
            });
            // Hand over the source port
            this.logger.info("Hand off source socket.");
            rpc.request("source_socket", null, this.master.sourcein.server, (err) => {
              if (err) {
                this.logger.error(`Error sending source socket: ${err}`);
              }
              return _afterSockets();
            });
            this.logger.info("Hand off master socket.");
            return rpc.request("master_handle", null, this.handle, (err) => {
              if (err) {
                this.logger.error(`Error sending master handle: ${err}`);
              }
              return _afterSockets();
            });
          });
        });
      });
    }

    //----------
    _acceptHandoff(cb) {
      var handoff_timer;
      this.logger.info("Initializing handoff receptor.");
      debug("In _acceptHandoff");
      if (!this._rpc) {
        cb(new Error("Handoff called, but no RPC interface set up."));
        return false;
      }
      // If we don't get HANDOFF_GO quickly, something is probably wrong.
      // Perhaps we've been asked to start via handoff when there's no process
      // out there to send us data.
      handoff_timer = setTimeout(() => {
        debug("Handoff failed to handshake. Done waiting.");
        return cb(new Error("Handoff failed to handshake within five seconds."));
      }, 5000);
      debug("Waiting for HANDOFF_GO");
      return this._rpc.once("HANDOFF_GO", (msg, handle, ccb) => {
        clearTimeout(handoff_timer);
        debug("HANDOFF_GO received.");
        ccb(null, "GO");
        // watch for streams
        debug("Waiting for internal configuration signal.");
        return this.master.once_configured(() => {
          // signal that we're ready
          debug("Telling handoff sender that we're configured.");
          return this._rpc.request("configured", this.master.config(), (err, reply) => {
            var aFunc;
            if (err) {
              this.logger.error(`Failed to send config broadcast when starting handoff: ${err}`);
              return false;
            }
            debug("Handoff sender ACKed config.");
            this.logger.info("Handoff initiator ACKed our config broadcast.");
            this.master.loadHandoffData(this._rpc, () => {
              return this.logger.info("Handoff receiver believes all stream and source data has arrived.");
            });
            aFunc = _.after(2, () => {
              this.logger.info("Source and Master handles are up.");
              return typeof cb === "function" ? cb(null, this) : void 0;
            });
            this._rpc.once("source_socket", (msg, handle, cb) => {
              this.logger.info("Source socket is incoming.");
              this.master.sourcein.listen(handle);
              cb(null);
              return aFunc();
            });
            return this._rpc.once("master_handle", (msg, handle, cb) => {
              var ref;
              this.logger.info("Master socket is incoming.");
              this.handle = this.server.listen(handle);
              if ((ref = this.master.slaves) != null) {
                ref.listen(this.handle);
              }
              cb(null);
              return aFunc();
            });
          });
        });
      });
    }

  };

  MasterMode.prototype.MODE = "Master";

  return MasterMode;

}).call(this);

//----------

//# sourceMappingURL=master.js.map
