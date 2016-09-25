var BaseOutput, debug, uuid, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require("underscore");

uuid = require("node-uuid");

debug = require('debug')('sm:outputs:base');

module.exports = BaseOutput = (function(_super) {
  __extends(BaseOutput, _super);

  function BaseOutput(output) {
    var a_session, _ref, _ref1;
    this.disconnected = false;
    this.client = {
      output: output
    };
    this.socket = null;
    if (this.opts.req && this.opts.res) {
      this.client.ip = this.opts.req.ip;
      this.client.path = this.opts.req.url;
      this.client.ua = _.compact([this.opts.req.params.ua, (_ref = this.opts.req.headers) != null ? _ref['user-agent'] : void 0]).join(" | ");
      this.client.user_id = this.opts.req.user_id;
      this.client.pass_session = true;
      this.client.session_id = (a_session = (_ref1 = this.opts.req.headers) != null ? _ref1['x-playback-session-id'] : void 0) ? (this.client.pass_session = false, a_session) : this.opts.req.params.session_id ? this.opts.req.params.session_id : uuid.v4();
      this.socket = this.opts.req.connection;
    } else {
      this.client = this.opts.client;
      this.socket = this.opts.socket;
    }
  }

  BaseOutput.prototype.disconnect = function(cb) {
    if (!this.disconnected) {
      this.disconnected = true;
      this.emit("disconnect");
      return typeof cb === "function" ? cb() : void 0;
    }
  };

  return BaseOutput;

})(require("events").EventEmitter);

//# sourceMappingURL=base.js.map
