const _ = require("lodash");
const uuid = require("node-uuid");
const EventEmitter = require("events").EventEmitter;

module.exports = class BaseOutput extends EventEmitter {
  disconnected = true;
  socket = null;

  constructor({ type, stream, req, res, ctx }) {
    var a_session, ref, ref1;
    super();
    this.stream = stream;
    this.opts = {req, res };

    this.client = {
      output: type
    };

    this.logger = ctx.logger.child({
      component: `output-${type}[${stream.key}]`,
    })

    this.client.ip = this.opts.req.ip;
    this.client.path = this.opts.req.url;
    this.client.ua = _.compact([this.opts.req.query.ua, (ref = this.opts.req.headers) != null ? ref['user-agent'] : void 0]).join(" | ");
    this.client.user_id = this.opts.req.user_id;
    this.client.pass_session = true;
    this.client.session_id = (a_session = (ref1 = this.opts.req.headers) != null ? ref1['x-playback-session-id'] : void 0) ? (this.client.pass_session = false, a_session) : this.opts.req.query.session_id ? this.opts.req.query.session_id : uuid.v4();
    this.socket = this.opts.req.connection;
  }

  static canHandleRequest(req) {
    throw new Error('Must implement!');
  }

  disconnect(cb) {
    if (this.disconnected) {
      return;
    }

    this.disconnected = true;
    this.emit("disconnect");
    cb && cb();
  }
};
