var SlaveConnection, SlaveServer, SocketIO, _;

_ = require("underscore");

SocketIO = require("socket.io");

SlaveConnection = require('./slave_connection');

module.exports = SlaveServer = class SlaveServer extends require("events").EventEmitter {
  constructor(ctx) {
    var cUpdate;
    super();
    this.ctx = ctx;
    this.master = this.ctx.master;
    this.config = this.ctx.config;
    this.logger = this.ctx.logger.child({
      component: "slave_server"
    });
    this.io = null;
    this.slaves = {};
    this._config = null;
    cUpdate = _.debounce(() => {
      var config, id, ref, results, s;
      config = this.master.config();
      ref = this.slaves;
      results = [];
      for (id in ref) {
        s = ref[id];
        this.logger.debug(`emit config to slave ${id}`);
        results.push(s.socket.emit("config", config));
      }
      return results;
    }, 200);
    this.master.on("config_update", cUpdate);
  }

  //----------
  updateConfig(config) {
    var id, ref, results, s;
    this._config = config;
    ref = this.slaves;
    results = [];
    for (id in ref) {
      s = ref[id];
      results.push(s.socket.emit("config", config));
    }
    return results;
  }

  //----------
  listen(server) {
    // fire up a socket listener on our slave port
    this.io = SocketIO.listen(server);
    this.logger.info("Master now listening for slave connections.");
    // add our authentication
    this.io.use((socket, next) => {
      var ref;
      this.logger.debug("Authenticating slave connection.");
      if (this.config.master.password === ((ref = socket.request._query) != null ? ref.password : void 0)) {
        this.logger.debug("Slave password is valid.");
        return next();
      } else {
        this.logger.warn("Slave password is incorrect.");
        return next(new Error("Invalid slave password."));
      }
    });
    // look for slave connections
    return this.io.on("connection", (sock) => {
      this.logger.debug("Master got connection");
      // a slave may make multiple connections to test transports. we're
      // only interested in the one that gives us the OK
      return sock.once("ok", (cb) => {
        this.logger.debug(`Got OK from incoming slave connection at ${sock.id}`);
        // ping back to let the slave know we're here
        cb("OK");
        this.logger.debug(`slave connection is ${sock.id}`);
        if (this._config) {
          sock.emit("config", this._config);
        }
        this.slaves[sock.id] = new SlaveConnection(this.ctx, sock);
        return this.slaves[sock.id].on("disconnect", () => {
          delete this.slaves[sock.id];
          return this.emit("disconnect", sock.id);
        });
      });
    });
  }

  //----------
  broadcastAudio(k, chunk) {
    var id, ref, results, s;
    ref = this.slaves;
    results = [];
    for (id in ref) {
      s = ref[id];
      results.push(s.socket.emit("audio", {
        stream: k,
        chunk: chunk
      }));
    }
    return results;
  }

  //----------
  pollForSync(cb) {
    var af, obj, ref, results, s, statuses;
    statuses = [];
    cb = _.once(cb);
    af = _.after(Object.keys(this.slaves).length, () => {
      return cb(null, statuses);
    });
    ref = this.slaves;
    // -- now check the slaves -- #
    results = [];
    for (s in ref) {
      obj = ref[s];
      results.push(((s, obj) => {
        var pollTimeout, saf, sstat;
        saf = _.once(af);
        sstat = {
          id: obj.id,
          UNRESPONSIVE: false,
          ERROR: null,
          status: {}
        };
        statuses.push(sstat);
        pollTimeout = setTimeout(() => {
          this.logger.error(`Slave ${s} failed to respond to status.`);
          sstat.UNRESPONSIVE = true;
          return saf();
        }, 1000);
        return obj.status((err, stat) => {
          clearTimeout(pollTimeout);
          if (err) {
            this.logger.error(`Slave ${s} reported status error: ${err}`);
          }
          sstat.ERROR = err;
          sstat.status = stat;
          return saf();
        });
      })(s, obj));
    }
    return results;
  }

};

//# sourceMappingURL=slave_server.js.map
