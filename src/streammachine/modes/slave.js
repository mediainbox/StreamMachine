var RPC, Slave, SlaveMode, _, nconf, path;

_ = require("underscore");

nconf = require("nconf");

path = require("path");

RPC = require("ipc-rpc");

Slave = require("../slave");

//----------
module.exports = SlaveMode = (function() {
  class SlaveMode extends require("./base_mode") {
    constructor(config, cb) {
      super(config);
      process.title = "SM:SLAVE";
      this.logger.debug("slave mode start");
      this._handle = null;
      this._haveHandle = false;
      this._shuttingDown = false;
      this._inHandoff = false;
      this._lastAddress = null;
      this._initFull = false;
      this.slave = new Slave(this.ctx);
    }

  };

  SlaveMode.prototype.MODE = "Slave";

  return SlaveMode;

}).call(this);
