var DebugTransport, Transport, debug, fs, path;

fs = require("fs");

path = require("path");

Transport = require('winston-transport');

debug = require("debug");

DebugTransport = (function() {
  class DebugTransport extends Transport {
    constructor(opts) {
      super(opts);
      this.defaultFn = require("debug")("sm:log");
      this.debugFnMap = {};
    }

    getDebugFn(info) {
      var component, debugLabel, fn, workerId;
      ({workerId, component} = info);
      if (!component) {
        return this.defaultFn;
      }
      debugLabel = 'sm:' + component + (workerId ? `(w${workerId})` : '');
      fn = this.debugFnMap[debugLabel];
      if (!fn) {
        fn = debug(debugLabel);
        this.debugFnMap[debugLabel] = fn;
      }
      return fn;
    }

    log(info, callback) {
      var fn;
      fn = this.getDebugFn(info);
      fn(`[${info.level}] ${info.message}`);
      return callback(null, true);
    }

  };

  DebugTransport.prototype.name = "debug";

  return DebugTransport;

}).call(this);

module.exports = {
  DebugTransport: DebugTransport
};

//# sourceMappingURL=transports.js.map
