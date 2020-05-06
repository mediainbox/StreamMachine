var SlaveConnection;

module.exports = SlaveConnection = class SlaveConnection extends require("events").EventEmitter {
  constructor(ctx, socket) {
    super();
    this.ctx = ctx;
    this.socket = socket;
    this.id = this.socket.id;
    this.last_status = null;
    this.last_err = null;
    this.connected_at = new Date();
    this.logger = this.ctx.logger.child({
      slave: this.socket.id
    });
    // -- wire up logging -- #
    this.logger = this.logger.child({
      slave: this.socket.id
    });
    this.socket.on("log", (obj = {}) => {
      return this.logger[obj.level || 'debug'].apply(this.logger, [obj.msg || "", obj.meta || {}]);
    });
    // -- RPC Handlers -- #
    this.socket.on("vitals", (key, cb) => {
      // respond with the stream's vitals
      return this.ctx.master.vitals(key, cb);
    });
    // attach disconnect handler
    this.socket.on("disconnect", () => {
      return this._handleDisconnect();
    });
  }

  //----------
  status(cb) {
    return this.socket.emit("status", (err, status) => {
      this.last_status = status;
      this.last_err = err;
      return cb(err, status);
    });
  }

  //----------
  _handleDisconnect() {
    var connected;
    connected = Math.round((Number(new Date()) - Number(this.connected_at)) / 60000);
    this.logger.debug(`slave ${this.socket.id} disconnected (connection lasted ${connected} minutes)`);
    return this.emit("disconnect");
  }

};

//# sourceMappingURL=slave_connection.js.map
