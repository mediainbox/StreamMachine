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
    constructor(config, cb) {
      super(config);
      process.title = "SM:SLAVE";
      this.logger.debug("Slave mode starting");
      this._handle = null;
      this._haveHandle = false;
      this._shuttingDown = false;
      this._inHandoff = false;
      this._lastAddress = null;
      this._initFull = false;
      this.slave = new Slave(_.extend({}, config, {
        logger: this.log
      }), this);
    }

  };

  SlaveMode.prototype.MODE = "Slave";

  return SlaveMode;

}).call(this);

//# sourceMappingURL=slave.js.map
