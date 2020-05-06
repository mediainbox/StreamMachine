var SlaveIO, Socket;

Socket = require("socket.io-client");

module.exports = SlaveIO = class SlaveIO extends require("events").EventEmitter {
  constructor(slave, _log, opts) {
    super();
    this.slave = slave;
    this._log = _log;
    this.opts = opts;
    this.connected = false;
    this.io = null;
    this.id = null;
    this.attempts = 1;
    this.masterIndex = -1;
    this.forceDisconnect = false;
    // -- connect to the master server -- #
    this._log.debug("Connecting to master at ", {
      master: this.opts.master
    });
    this._start();
  }

  //----------
  once_connected(cb) {
    if (this.connected) {
      return cb(null, this.io);
    } else {
      return this.once("connected", () => {
        return cb(null, this.io);
      });
    }
  }

  //----------
  _start() {
    var master;
    master = this.opts.master;
    if (typeof master !== "string") {
      if (master.length !== (this.masterIndex + 1)) {
        this.masterIndex = this.masterIndex + 1;
      }
      if (this.attempts >= this.opts.retry) {
        this.attempts = 1;
      }
      master = master[this.masterIndex];
    }
    this.disconnect();
    return this._connect(master);
  }

  //----------
  disconnect() {
    var ref;
    this.forceDisconnect = true;
    return (ref = this.io) != null ? ref.disconnect() : void 0;
  }

  //----------
  _connect(master) {
    this._log.info(`Slave trying connection to master ${master}`);
    this.io = Socket.connect(master, {
      reconnection: true,
      timeout: this.opts.timeout
    });
    // -- handle new connections -- #
    this.io.on("connect", () => {
      var pingTimeout;
      this._log.debug("Slave in _onConnect.");
      // make sure our connection is valid with a ping
      pingTimeout = setTimeout(() => {
        return this._log.error("Failed to get master OK ping.");
      // FIXME: exit?
      }, 1000);
      return this.io.emit("ok", (res) => {
        clearTimeout(pingTimeout);
        if (res === "OK") {
          // connect up our logging proxy
          this._log.debug("Connected to master.");
          this.id = this.io.io.engine.id;
          this.connected = true;
          return this.emit("connected");
        } else {
          return this._log.error(`Master OK ping response invalid: ${res}`);
        }
      });
    });
    // FIXME: exit?

    // -- handle errors -- #
    this.io.on("connect_error", (err) => {
      if (err.code = ~/ECONNREFUSED/) {
        this._log.info(`Slave connection refused: ${err}`);
      } else {
        this._log.info(`Slave got connection error of ${err}`, {
          error: err
        });
        console.log("got connection error of ", err);
      }
      this.attempts = this.attempts + 1;
      if (this.isNecesaryReconnect()) {
        return this._start();
      }
    });
    // -- handle disconnects -- #
    this.io.on("disconnect", () => {
      this.connected = false;
      this._log.debug("Disconnected from master.");
      return this.emit("disconnect");
    });
    // FIXME: Exit?

    // -- RPC calls -- #
    this.io.on("config", (config) => {
      return this.slave.configureStreams(config.streams);
    });
    this.io.on("status", (cb) => {
      return this.slave._streamStatus(cb);
    });
    this.io.on("should_shutdown", (cb) => {
      return this.slave._shutdown(cb);
    });
    return this.io.on("audio", (obj) => {
      // our data gets converted into an ArrayBuffer to go over the
      // socket. convert it back before insertion
      obj.chunk.data = Buffer.from(obj.chunk.data);
      // convert timestamp back to a date object
      obj.chunk.ts = new Date(obj.chunk.ts);
      return this.emit(`audio:${obj.stream}`, obj.chunk);
    });
  }

  //----------
  isNecesaryReconnect() {
    var master;
    master = this.opts.master;
    if (typeof master !== "string") {
      if (this.attempts < this.opts.retry) {
        return false;
      } else if (master.length !== (this.masterIndex + 1)) {
        return true;
      }
    }
    return false;
  }

  //----------
  vitals(key, cb) {
    return this.io.emit("vitals", key, cb);
  }

  log(obj) {
    return this.io.emit("log", obj);
  }

};

//# sourceMappingURL=slave_io.js.map
