var Events, MasterConnection, Socket;

Socket = require("socket.io-client");

({Events} = require('../../events'));

// This is the component that interacts with Master
// See events.

module.exports = MasterConnection = class MasterConnection extends require("events").EventEmitter {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.logger = this.ctx.logger.child({
      component: 'slave:master-connection'
    });
    this.config = this.ctx.config.slave;
    this.connected = false;
    this.io = null;
    this.id = null;
    this.attempts = 1;
    this.masterIndex = -1;
    this.forceDisconnect = false;
    // -- connect to the master server -- #
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
    master = this.config.master;
    if (typeof master !== "string") {
      if (master.length !== (this.masterIndex + 1)) {
        this.masterIndex = this.masterIndex + 1;
      }
      if (this.attempts >= this.config.retry) {
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
    this.logger.debug(`connect to master at ${master}`);
    this.io = Socket.connect(master, {
      reconnection: true,
      timeout: this.config.timeout
    });
    // -- handle new connections -- #
    this.io.on("connect", () => {
      var pingTimeout;
      this.logger.debug("Slave in _onConnect.");
      // make sure our connection is valid with a ping
      pingTimeout = setTimeout(() => {
        return this.logger.error("Failed to get master OK ping.");
      // FIXME: exit?
      }, 1000);
      return this.io.emit(Events.IO.CONNECTION_OK, (res) => {
        clearTimeout(pingTimeout);
        if (res === "OK") {
          // connect up our logging proxy
          this.logger.debug("Connected to master.");
          this.id = this.io.io.engine.id;
          this.connected = true;
          return this.emit("connected");
        } else {
          return this.logger.error(`Master OK ping response invalid: ${res}`);
        }
      });
    });
    // FIXME: exit?

    // -- handle errors -- #
    this.io.on("connect_error", (err) => {
      if (err.code = ~/ECONNREFUSED/) {
        this.logger.info(`Slave connection refused: ${err}`);
      } else {
        this.logger.info(`Slave got connection error of ${err}`, {
          error: err
        });
        console.log("got connection error of ", err);
      }
      this.attempts = this.attempts + 1;
      if (this.isNecesaryReconnect()) {
        return this._start();
      }
    });
    this.io.on("disconnect", () => {
      this.connected = false;
      this.logger.debug("Disconnected from master.");
      return this.emit("disconnect");
    });
    // FIXME: Exit?
    this.io.on(Events.IO.CONFIG, (config) => {
      return this.ctx.slave.configureStreams(config.streams);
    });
    this.io.on(Events.IO.SLAVE_STATUS, (cb) => {
      return this.ctx.slave._streamStatus(cb);
    });
    return this.io.on(Events.IO.AUDIO, (obj) => {
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
    master = this.config.master;
    if (typeof master !== "string") {
      if (this.attempts < this.config.retry) {
        return false;
      } else if (master.length !== (this.masterIndex + 1)) {
        return true;
      }
    }
    return false;
  }

  //----------
  vitals(key, cb) {
    return this.io.emit(Events.IO.SLAVE_VITALS, key, cb);
  }

  log(obj) {
    return this.io.emit("log", obj);
  }

};

//# sourceMappingURL=master_connection.js.map
