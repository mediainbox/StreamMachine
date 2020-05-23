const _ = require("lodash");
const Slave = require("../slave/Slave");

module.exports = class SlaveMode extends require("./base_mode") {
  MODE = "Slave";

  constructor(config, cb) {
    super(config);
    process.title = "SM:SLAVE";
    this.logger.info("slave mode start");
    this._handle = null;
    this._haveHandle = false;
    this._shuttingDown = false;
    this._inHandoff = false;
    this._lastAddress = null;
    this._initFull = false;
    this.slave = new Slave(this.ctx);
  }
}
