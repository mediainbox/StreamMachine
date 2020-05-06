var BaseOutput, _, debug, uuid;

_ = require("underscore");

uuid = require("node-uuid");

debug = require('debug')('sm:outputs:base');

module.exports = BaseOutput = class BaseOutput extends require("events").EventEmitter {
  constructor(output) {
    var a_session, ref, ref1;
    super();
    this.disconnected = false;
    // turn @opts into @client
    this.client = {
      output: output
    };
    this.socket = null;
    if (this.opts.req && this.opts.res) {
      // -- startup mode...  sending headers -- #
      this.client.ip = this.opts.req.ip;
      //@client.ip          = @opts.req.connection.remoteAddress
      this.client.path = this.opts.req.url;
      this.client.ua = _.compact([this.opts.req.query.ua, (ref = this.opts.req.headers) != null ? ref['user-agent'] : void 0]).join(" | ");
      this.client.user_id = this.opts.req.user_id;
      this.client.pass_session = true;
      // use passed-in session id
      // generate session id
      this.client.session_id = (a_session = (ref1 = this.opts.req.headers) != null ? ref1['x-playback-session-id'] : void 0) ? (this.client.pass_session = false, a_session) : this.opts.req.query.session_id ? this.opts.req.query.session_id : uuid.v4();
      this.socket = this.opts.req.connection;
    } else {
      this.client = this.opts.client;
      this.socket = this.opts.socket;
    }
  }

  //----------
  disconnect(cb) {
    if (!this.disconnected) {
      this.disconnected = true;
      this.emit("disconnect");
      return typeof cb === "function" ? cb() : void 0;
    }
  }

};

//# sourceMappingURL=base.js.map
