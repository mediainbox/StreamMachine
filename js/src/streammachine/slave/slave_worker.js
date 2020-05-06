var Logger, RPC, Slave, SlaveWorker, _, debug;

RPC = require("ipc-rpc");

_ = require("underscore");

Logger = require("../logger");

Slave = require("./");

debug = require("debug")("sm:slave:slave_worker");

// TEMP
process.on("uncaughtException", function(err) {
  console.error(`err is: ${err}`);
  return console.error("err stack is: ", err.stack);
});

module.exports = SlaveWorker = class SlaveWorker {
  constructor() {
    this._config = null;
    this._configured = false;
    this._loaded = false;
    debug("Init for SlaveWorker");
    // -- Set up RPC -- #
    new RPC(process, {
      functions: {
        status: (msg, handle, cb) => {
          return this.slave._streamStatus(cb);
        },
        //---

        // Accept an incoming connection attempt
        connection: (msg, sock, cb) => {
          sock.allowHalfOpen = true;
          this.slave.server.handle(sock);
          return cb(null, "OK");
        },
        // Accept a listener that we should now start serving
        land_listener: (msg, handle, cb) => {
          return this.slave.landListener(msg, handle, cb);
        },
        //---

        // Request to send all our listeners to the main slave process,
        // probably so that it can whack us
        send_listeners: (msg, handle, cb) => {
          return this.slave.ejectListeners((obj, h, lcb) => {
            return this._rpc.request("send_listener", obj, h, (err) => {
              return lcb();
            });
          }, (err) => {
            return cb(err);
          });
        },
        //---

        // Request asking that we shut down...
        shutdown: (msg, handle, cb) => {
          // we ask the slave instance to shut down. It in turn asks us
          // to distribute its listeners.
          if (this.slave) {
            return this.slave._shutdown((err) => {
              return cb(err);
            });
          } else {
            // we haven't gotten far enough... just exit
            cb(null);
            return setTimeout(() => {
              return process.exit();
            }, 100);
          }
        }
      }
    }, (err, rpc) => {
      this._rpc = rpc;
      // We're initially loaded via no config. At this point, we need
      // to request config from the main slave process.
      debug("Requesting slave config over RPC");
      return this._rpc.request("config", (err, obj) => {
        var agent;
        if (err) {
          console.error(`Error loading config: ${err}`);
          process.exit(1);
        }
        debug("Slave config received");
        this._config = obj;
        if (this._config["enable-webkit-devtools-slaveworker"]) {
          console.log("ENABLING WEBKIT DEVTOOLS IN SLAVE WORKER");
          agent = require("webkit-devtools-agent");
          agent.start();
        }
        this.log = (new Logger(this._config.log)).child({
          mode: "slave_worker",
          pid: process.pid
        });
        this.log.debug("SlaveWorker initialized");
        // -- Create our Slave Instance -- #
        debug("Creating slave instance");
        this.slave = new Slave(_.extend(this._config, {
          logger: this.log
        }), this);
        // -- Communicate Config Back to Slave -- #

        // we watch the slave instance, and communicate its config event back
        // to the main slave
        this.slave.once_configured(() => {
          debug("Slave instance says it is configured");
          this._configured = true;
          return this._rpc.request("worker_configured", (err) => {
            if (err) {
              return this.log.error(`Error sending worker_configured: ${err}`);
            } else {
              this.log.debug("Controller ACKed that we're configured.");
              return debug("Slave controller ACKed our config");
            }
          });
        });
        // -- Communicate Rewinds Back to Slave -- #

        // when all rewinds are loaded, pass that word on to our main slave
        return this.slave.once_rewinds_loaded(() => {
          debug("Slave instance says rewinds are loaded");
          this._loaded = true;
          return this._rpc.request("rewinds_loaded", (err) => {
            if (err) {
              return this.log.error(`Error sending rewinds_loaded: ${err}`);
            } else {
              this.log.debug("Controller ACKed that our rewinds are loaded.");
              return debug("Slave controller ACKed that our rewinds are loaded");
            }
          });
        });
      });
    });
  }

  //----------

    // A slave worker instance can request to shut down either
  // because it got a request to do so from the master, or
  // because of some sort of a fault condition in the worker.

    // To shut down, we need to transfer the worker instance's
  // listeners to a different worker.
  shutdown(cb) {
    this.log.info("Triggering listener ejection after shutdown request.");
    return this.slave.ejectListeners((obj, h, lcb) => {
      return this._rpc.request("send_listener", obj, h, (err) => {
        return lcb();
      });
    }, (err) => {
      // now that we're finished transferring listeners, we need to
      // go ahead and shut down
      this.log.info("Listener ejection completed. Shutting down...");
      cb(err);
      return setTimeout(() => {
        this.log.info("Shutting down.");
        return process.exit(1);
      }, 300);
    });
  }

};

//# sourceMappingURL=slave_worker.js.map
