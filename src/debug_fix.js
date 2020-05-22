'use strict';

const debug  = require('debug');
const logger = debug('test');

// wrap debug.formatArgs() implementation
const origFormatArgs = debug.formatArgs;
debug.formatArgs = function () {
  var args = arguments;
  var name = this.namespace;

  var c = this.color;

  const now = new Date();
  const ts = `${now.toLocaleTimeString()}.${now.getMilliseconds()}`;

  args[0] = ts + ' \u001b[3' + c + ';1m' + name + ' '
    + '\u001b[0m'
    + args[0] + '\u001b[3' + c + 'm'
    + '\u001b[0m';

  return args;
};
