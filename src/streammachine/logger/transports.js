var DebugTransport, Transport, _, debug, fs, path;

fs = require("fs");

path = require("path");

Transport = require('winston-transport');

debug = require("debug");

_ = require("lodash");

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
      var component, fn, level, message, meta, metaToLog, workerId;
      ({level, message, component, workerId, ...meta} = info);
      fn = this.getDebugFn(info);
      metaToLog = _.pickBy(meta, function(value, key) {
        return typeof key !== 'symbol';
      });
      //fn(`[${level}] ${message}`, metaToLog);
      fn(`[${level}] ${message}`);
      return callback(null, true);
    }

  };

  DebugTransport.prototype.name = "debug";

  return DebugTransport;

}).call(this);

module.exports = {
  DebugTransport: DebugTransport
};
