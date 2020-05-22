const _ = require("lodash");
const SocketIO = require("socket.io");
const SlaveConnection = require('./slave_connection');
const {Events} = require('../../events');

// Socket.IO server that listens for Slave connections
// Will create a SlaveConnection for each connected Slave
// See also slave/MasterConnection for the counterpart on the slave
// Emits:
// - Events.Link.CONFIG
// - Events.Link.AUDIO

const CONFIG_UPDATE_DEBOUNCE = 200;

module.exports = class SlaveServer extends require("events").EventEmitter {
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
    this.slaveConnections = {};
    this._config = null;
    cUpdate = _.debounce(() => {
      var config, id, ref, results, s;
      config = this.master.config();
      ref = this.slaveConnections;
      results = [];
      for (id in ref) {
        s = ref[id];
        this.logger.debug(`emit config to slave ${id}`);
        results.push(s.socket.emit(Events.Link.CONFIG, config));
      }
      return results;
    }, CONFIG_UPDATE_DEBOUNCE);
    this.master.on(Events.Master.CONFIG_UPDATE, cUpdate);
  }

  updateConfig(config) {
    var id, ref, results, s;
    this._config = config;
    ref = this.slaveConnections;
    results = [];
    for (id in ref) {
      s = ref[id];
      results.push(s.socket.emit(Events.Link.CONFIG, config));
    }
    return results;
  }

  listen(server) {
    // fire up a socket listener on our slave port
    this.io = SocketIO.listen(server, {
      pingInterval: 15000,
      pingTimeout: 30000,
    });
    this.logger.info("master now listening for ws slave connections");
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
    return this.io.on("connect", (sock) => {
      this.logger.debug("Master got connection");
      // a slave may make multiple connections to test transports. we're
      // only interested in the one that gives us the OK
      return sock.once(Events.Link.CONNECTION_VALIDATE, (cb) => {
        this.logger.debug(`Got OK from incoming slave connection at ${sock.id}`);
        // ping back to let the slave know we're here
        cb("OK");
        this.logger.debug(`slave connection is ${sock.id}`);
        if (this._config) {
          sock.emit(Events.Link.CONFIG, this._config);
        }
        this.slaveConnections[sock.id] = new SlaveConnection(this.ctx, sock);
        return this.slaveConnections[sock.id].on(Events.Link.DISCONNECT, () => {
          delete this.slaveConnections[sock.id];
          return this.emit("disconnect", sock.id);
        });
      });
    });
  }

  broadcastAudio(k, chunk) {
    var id, ref, results, s;
    ref = this.slaveConnections;
    results = [];
    for (id in ref) {
      s = ref[id];
      results.push(s.socket.emit(Events.Link.AUDIO, {
        stream: k,
        chunk: chunk
      }));
    }
    return results;
  }

  pollForSync(cb) {
    var af, obj, ref, results, s, statuses;
    statuses = [];
    cb = _.once(cb);
    af = _.after(Object.keys(this.slaveConnections).length, () => {
      return cb(null, statuses);
    });
    ref = this.slaveConnections;
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
