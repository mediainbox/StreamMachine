var SlaveConnection;

module.exports = SlaveConnection = class SlaveConnection extends require("events").EventEmitter {
  constructor(sio, sock) {
    super();
    this.sio = sio;
    this.sock = sock;
    this.id = this.sock.id;
    this.last_status = null;
    this.last_err = null;
    this.connected_at = new Date();
    // -- wire up logging -- #
    this.socklogger = this.sio.log.child({
      slave: this.sock.id
    });
    this.sock.on("log", (obj = {}) => {
      return this.socklogger[obj.level || 'debug'].apply(this.socklogger, [obj.msg || "", obj.meta || {}]);
    });
    // -- RPC Handlers -- #
    this.sock.on("vitals", (key, cb) => {
      // respond with the stream's vitals
      return this.sio.master.vitals(key, cb);
    });
    // attach disconnect handler
    this.sock.on("disconnect", () => {
      return this._handleDisconnect();
    });
  }

  //----------
  status(cb) {
    return this.sock.emit("status", (err, status) => {
      this.last_status = status;
      this.last_err = err;
      return cb(err, status);
    });
  }

  //----------
  _handleDisconnect() {
    var connected;
    connected = Math.round((Number(new Date()) - Number(this.connected_at)) / 1000);
    this.sio.log.debug(`Slave disconnect from ${this.sock.id}. Connected for ${connected} seconds.`);
    return this.emit("disconnect");
  }

};

//# sourceMappingURL=slave_.js.map
