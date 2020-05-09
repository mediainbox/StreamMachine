const _ = require("lodash");
const Slave = require("../slave");

module.exports = class SlaveMode extends require("./base_mode") {
  MODE = "Slave";

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
}
