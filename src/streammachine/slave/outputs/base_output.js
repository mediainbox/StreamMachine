const _ = require("lodash");
const EventEmitter = require("events").EventEmitter;

module.exports = class BaseOutput extends EventEmitter {
  disconnected = true;

  constructor({ stream, ctx }) {
    super();

    this.stream = stream;
    this.ctx = ctx;

    this.logger = ctx.logger.child({
      component: `output-${this.getType()}[${stream.key}]`,
    })
  }

  getType() {
    throw new Error('Must implement getType()');
  }

  preroll() {
    throw new Error('Must implement preroll()');
  }
};
