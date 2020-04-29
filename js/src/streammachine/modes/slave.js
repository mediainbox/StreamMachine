var CP, Logger, RPC, Slave, SlaveMode, debug, nconf, net, path, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require("underscore");

nconf = require("nconf");

path = require("path");

RPC = require("ipc-rpc");

net = require("net");

CP = require("child_process");

Logger = require("../logger");

Slave = require("../slave");

debug = require("debug")("sm:modes:slave");

module.exports = SlaveMode = (function(_super) {
  __extends(SlaveMode, _super);

  SlaveMode.prototype.MODE = "Slave";

  function SlaveMode(opts, cb) {
    this.opts = opts;
    this.log = (new Logger(this.opts.log)).child({
      mode: 'slave',
      pid: process.pid
    });
    this.log.debug("Slave Instance initialized");
    debug("Slave Mode init");
    process.title = "StreamM:slave";
    SlaveMode.__super__.constructor.apply(this, arguments);
    this._handle = null;
    this._haveHandle = false;
    this._shuttingDown = false;
    this._inHandoff = false;
    this._lastAddress = null;
    this._initFull = false;
    this.slave = new Slave(_.extend({}, this.opts, {
      logger: this.log
    }), this);
  }

  return SlaveMode;

})(require("./base"));

//# sourceMappingURL=slave.js.map
