const fs = require("fs");
const path = require("path");
const Transport = require('winston-transport');
const debug = require("debug");
const _ = require("lodash");

class DebugTransport extends Transport {
  name = 'debug';
  defaultFn = require("debug")("sm:log");
  debugFnMap = {};

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
}

module.exports = {
  DebugTransport: DebugTransport
};
