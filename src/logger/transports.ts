import Transport from 'winston-transport';
import debug from "debug";
import _ from "lodash";

export class DebugTransport extends Transport {
  name = 'debug';
  defaultFn = require("debug")("sm:log");
  debugFnMap: Record<string, (...args: any[]) => void> = {};

  getDebugFn(info: any) {
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

  log(info: any, callback: (error: Error | null, value: any) => void) {
    const {level, message, component, workerId, timestamp, hostname, pid, ...meta} = info;
    const fn = this.getDebugFn(info);
    const metaToLog = _.pickBy(meta, function(value, key) {
      return typeof key !== 'symbol';
    });

    fn(`[${level}] ${message}`, metaToLog);

    return callback(null, true);
  }
}
