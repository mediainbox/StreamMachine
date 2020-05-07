var Logger, Master, Slave, StandaloneMode, _, debug, express, nconf;

_ = require("underscore");

express = require("express");

nconf = require("nconf");

Logger = require("../logger");

Master = require("../master");

Slave = require("../slave");

debug = require("debug")("sm:modes:standalone");

module.exports = StandaloneMode = (function() {
  class StandaloneMode extends require("./base_mode") {
    constructor(opts1, cb) {
      super(opts);
      this.opts = opts1;
      // -- Set up logging -- #
      this.log = (new Logger(this.opts.log)).child({
        pid: process.pid
      });
      this.log.debug("StreamMachine standalone initialized.");
      process.title = "StreamMachine";
      this.streams = {};
      // -- Set up master and slave -- #
      this.master = new Master(_.extend({}, this.opts, {
        logger: this.log.child({
          mode: "master"
        })
      }));
      this.slave = new Slave(_.extend({}, this.opts, {
        logger: this.log.child({
          mode: "slave"
        })
      }));
      // -- Set up our server(s) -- #
      this.server = express();
      this.api_server = null;
      this.api_handle = null;
      if (this.opts.api_port) {
        this.api_server = express();
        this.api_server.use("/api", this.master.api.app);
      } else {
        this.log.error("USING API ON MAIN PORT IS UNSAFE! See api_port documentation.");
        this.server.use("/api", this.master.api.app);
      }
      this.server.use(this.slave.server.app);
      // -- set up RPC -- #
      if (process.send != null) {
        this._rpc = new RPC(process, {
          functions: {
            OK: function(msg, handle, cb) {
              return cb(null, "OK");
            },
            standalone_port: (msg, handle, cb) => {
              var ref;
              return cb(null, ((ref = this.handle) != null ? ref.address().port : void 0) || "NONE");
            },
            source_port: (msg, handle, cb) => {
              var ref, ref1;
              return cb(null, ((ref = this.master.sourcein) != null ? (ref1 = ref.server.address()) != null ? ref1.port : void 0 : void 0) || "NONE");
            },
            api_port: (msg, handle, cb) => {
              var ref;
              return cb(null, (typeof api_handle !== "undefined" && api_handle !== null ? (ref = api_handle.address()) != null ? ref.port : void 0 : void 0) || "NONE");
            },
            stream_listener: (msg, handle, cb) => {
              return this.slave.landListener(msg, handle, cb);
            },
            config: (config, handle, cb) => {
              return this.master.configure(config, (err) => {
                return cb(err, this.master.config());
              });
            },
            status: (msg, handle, cb) => {
              return this.status(cb);
            }
          }
        });
      }
      // -- Proxy data events from master -> slave -- #
      this.master.on("streams", (streams) => {
        debug("Standalone saw master streams event");
        this.slave.once("streams", () => {
          var k, ref, results, v;
          debug("Standalone got followup slave streams event");
          ref = this.master.streams;
          results = [];
          for (k in ref) {
            v = ref[k];
            debug(`Checking stream ${k}`);
            if (this.slave.streams[k] != null) {
              debug(`Mapping master -> slave for ${k}`);
              this.log.debug(`mapping master -> slave on ${k}`);
              if (!this.slave.streams.source) {
                results.push(this.slave.streams[k].useSource(v));
              } else {
                results.push(void 0);
              }
            } else {
              results.push(this.log.error(`Unable to map master -> slave for ${k}`));
            }
          }
          return results;
        });
        return this.slave.configureStreams(this.master.config().streams);
      });
      this.log.info(`Standalone is listening on port ${this.opts.port}`);
      // -- Handoff? -- #
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
          this.log.error(`_handoffStart Failed! Falling back to normal start: ${err}`);
          return this._normalStart(cb);
        }
      });
    }

    //----------
    _normalStart(cb) {
      this.log.info("Attaching listeners.");
      this.master.sourcein.listen();
      this.handle = this.server.listen(this.opts.port);
      if (this.api_server) {
        this.log.info(`Starting API server on port ${this.opts.api_port}`);
        this.api_handle = this.api_server.listen(this.opts.api_port);
      }
      return typeof cb === "function" ? cb(null, this) : void 0;
    }

    //----------
    status(cb) {
      var aF, status;
      status = {
        master: null,
        slave: null
      };
      aF = _.after(2, () => {
        return cb(null, status);
      });
      // master status
      status.master = this.master.status();
      aF();
      // slave status
      return this.slave._streamStatus((err, s) => {
        if (err) {
          return cb(err);
        }
        status.slave = s;
        return aF();
      });
    }

    //----------
    _sendHandoff(rpc) {
      this.log.event("Got handoff signal from new process.");
      debug("In _sendHandoff. Waiting for config.");
      return rpc.once("configured", (msg, handle, cb) => {
        debug("... got configured. Syncing running config.");
        // send stream/source info so we make sure our configs are matched
        return rpc.request("config", this.master.config(), (err, streams) => {
          if (err) {
            this.log.error(`Error setting config on new process: ${err}`);
            cb(`Error sending config: ${err}`);
            return false;
          }
          this.log.info("New process confirmed configuration.");
          debug("New process confirmed configuration.");
          // basically we leave the config request open while we send streams
          cb();
          return this.master.sendHandoffData(rpc, (err) => {
            var _afterSockets;
            this.log.event("Sent master data to new process.");
            _afterSockets = _.after(3, () => {
              debug("Socket transfer is done.");
              this.log.info("Sockets transferred. Sending listeners.");
              // Send slave listener data
              debug("Beginning listener transfer.");
              return this.slave.ejectListeners((obj, h, lcb) => {
                debug("Sending a listener...", obj);
                return this._rpc.request("stream_listener", obj, h, (err) => {
                  if (err) {
                    debug(`Listener transfer error: ${err}`);
                  }
                  return lcb();
                });
              }, (err) => {
                if (err) {
                  this.log.error(`Error sending listeners during handoff: ${err}`);
                }
                this.log.info("Standalone handoff has sent all information. Exiting.");
                debug("Standalone handoff complete. Exiting.");
                // Exit
                return process.exit();
              });
            });
            // Hand over our public listening port
            this.log.info("Hand off standalone socket.");
            rpc.request("standalone_handle", null, this.handle, (err) => {
              if (err) {
                this.log.error(`Error sending standalone handle: ${err}`);
              }
              debug(`Standalone socket sent: ${err}`);
              this.handle.unref();
              return _afterSockets();
            });
            // Hand over the source port
            this.log.info("Hand off source socket.");
            rpc.request("source_socket", null, this.master.sourcein.server, (err) => {
              if (err) {
                this.log.error(`Error sending source socket: ${err}`);
              }
              debug(`Source socket sent: ${err}`);
              this.master.sourcein.server.unref();
              return _afterSockets();
            });
            this.log.info("Hand off API socket (if it exists).");
            return rpc.request("api_handle", null, this.api_handle, (err) => {
              var ref;
              if (err) {
                this.log.error(`Error sending API socket: ${err}`);
              }
              debug(`API socket sent: ${err}`);
              if ((ref = this.api_handle) != null) {
                ref.unref();
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
      this.log.info("Initializing handoff receptor.");
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
        debug("Waiting for internal configuration signal.");
        return this.master.once_configured(() => {
          // signal that we're ready
          debug("Telling handoff sender that we're configured.");
          return this._rpc.request("configured", this.master.config(), (err, reply) => {
            var aFunc;
            if (err) {
              this.log.error(`Failed to send config broadcast when starting handoff: ${err}`);
              return false;
            }
            debug("Handoff sender ACKed config.");
            this.log.info("Handoff initiator ACKed our config broadcast.");
            this.master.loadHandoffData(this._rpc, () => {
              return this.log.info("Master handoff receiver believes all stream and source data has arrived.");
            });
            aFunc = _.after(3, () => {
              this.log.info("All handles are up.");
              return typeof cb === "function" ? cb(null, this) : void 0;
            });
            this._rpc.once("source_socket", (msg, handle, cb) => {
              this.log.info("Source socket is incoming.");
              this.master.sourcein.listen(handle);
              debug("Now listening on source socket.");
              cb(null);
              return aFunc();
            });
            this._rpc.once("standalone_handle", (msg, handle, cb) => {
              this.log.info("Standalone socket is incoming.");
              this.handle = this.server.listen(handle);
              debug("Now listening on standalone socket.");
              cb(null);
              return aFunc();
            });
            return this._rpc.once("api_handle", (msg, handle, cb) => {
              if (handle && this.api_server) {
                debug("Handoff sent API socket and we have API server");
                this.log.info("API socket is incoming.");
                this.api_handle = this.api_server.listen(handle);
                debug("Now listening on API socket.");
              } else {
                this.log.info("Handoff sent no API socket");
                debug("Handoff sent no API socket.");
                if (this.api_server) {
                  debug("Handoff sent no API socket, but we have API server. Listening.");
                  this.api_handle = this.api_server.listen(this.opts.api_port);
                }
              }
              cb(null);
              return aFunc();
            });
          });
        });
      });
    }

  };

  StandaloneMode.prototype.MODE = "StandAlone";

  return StandaloneMode;

}).call(this);

//# sourceMappingURL=standalone.js.map
