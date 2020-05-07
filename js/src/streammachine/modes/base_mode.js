var BaseMode, _, createLogger, nconf;

nconf = require("nconf");

_ = require("underscore");

({createLogger} = require("../logger"));

module.exports = BaseMode = class BaseMode extends require("events").EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.ctx = {
      config: this.config,
      logger: createLogger(this.config),
      providers: {}
    };
    this.logger = this.ctx.logger.child({
      component: 'sm:' + this.config.mode
    });
    this.log = this.logger; // compatibility
    
    // see runner for restart trigger based on SIGUSR2
    this.logger.debug("attach listener for SIGUSR2 restarts.");
    if (process.listeners("SIGUSR2").length > 0) {
      this.logger.info("skipping SIGUSR2 registration for handoffs since another listener is registered.");
    } else {
      // Support a handoff trigger via USR2
      process.on("SIGUSR2", () => {
        if (this._restarting) {
          return false;
        }
        this._restarting = true;
        if (!this._rpc) {
          this.logger.error("StreamMachine process was asked for external handoff, but there is no RPC interface");
          this._restarting = false;
          return false;
        }
        this.logger.info("Sending process for USR2. Starting handoff via proxy.");
        return this._rpc.request("HANDOFF_GO", null, null, {
          timeout: 20000
        }, (err, reply) => {
          if (err) {
            this.logger.error(`Error handshaking handoff: ${err}`);
            this._restarting = false;
            return false;
          }
          this.logger.info("Sender got handoff handshake. Starting send.");
          return this._sendHandoff(this._rpc);
        });
      });
    }
  }

  //----------

    // Build a hash of stream information, including sources and listener counts
  streamInfo() {
    var k, ref, results, s;
    ref = this.streams;
    results = [];
    for (k in ref) {
      s = ref[k];
      results.push(s.info());
    }
    return results;
  }

};

//----------

//# sourceMappingURL=base_mode.js.map
