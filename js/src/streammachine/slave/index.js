var Alerts, EventTypes, EventsHub, MasterConnection, Server, Slave, SocketSource, Stream, _, tz;

_ = require("underscore");

Stream = require("./stream");

Server = require("./server");

Alerts = require("../alerts");

MasterConnection = require("./master_io/master_connection");

SocketSource = require("./socket_source");

({EventTypes, EventsHub} = require('./events'));

tz = require('timezone');

module.exports = Slave = (function() {
  class Slave extends require("events").EventEmitter {
    constructor(ctx) {
      var ref;
      super();
      this.ctx = ctx;
      this._configured = false;
      this.master = null;
      this.streams = {};
      this.stream_groups = {};
      this.root_route = null;
      this.connected = false;
      this._retrying = null;
      this._shuttingDown = false;
      // -- Global Stats -- #

      // we'll track these at the stream level and then bubble them up
      this._totalConnections = 0;
      this._totalKBytesSent = 0;
      // -- Set up logging -- #
      this.ctx.events = new EventsHub();
      this.ctx.slave = this;
      this.config = this.ctx.config;
      this.logger = this.ctx.logger.child({
        component: "slave"
      });
      this.logger.debug("initialize slave");
      // -- create an alerts object -- #
      this.alerts = new Alerts({
        logger: this.logger.child({
          module: "alerts"
        })
      });
      // -- Make sure we have the proper slave config options -- #
      if ((ref = this.config.slave) != null ? ref.master : void 0) {
        this.masterConnection = new MasterConnection(this.ctx);
        this.masterConnection.on("connected", () => {
          this.logger.debug("IO is connected");
          return this.alerts.update("slave_disconnected", this.masterConnection.id, false);
        });
        // TODO @logger.proxyToMaster(@masterConnection)
        this.masterConnection.on("disconnected", () => {
          this.logger.debug("IO is disconnected");
          return this.alerts.update("slave_disconnected", this.masterConnection.id, true);
        });
      }
      // TODO @logger.proxyToMaster()
      this.once("streams", () => {
        this.logger.debug("Streams event received");
        return this._configured = true;
      });
      // -- set up our stream server -- #
      this.server = new Server({
        core: this,
        logger: this.logger.child({
          subcomponent: "server"
        }),
        config: this.config
      });
    }

    //----------
    once_configured(cb) {
      if (this._configured) {
        return cb();
      } else {
        return this.once("streams", () => {
          return cb();
        });
      }
    }

    once_rewinds_loaded(cb) {
      return this.once_configured(() => {
        var aFunc, k, obj, ref, results;
        this.logger.debug(`Looking for sources to load in ${Object.keys(this.streams).length} streams.`);
        aFunc = _.after(Object.keys(this.streams).length, () => {
          this.logger.debug("All sources are loaded.");
          return cb();
        });
        ref = this.streams;
        results = [];
        for (k in ref) {
          obj = ref[k];
          // watch for each configured stream to have its rewind buffer loaded.
          results.push(obj._once_source_loaded(aFunc));
        }
        return results;
      });
    }

    //----------
    _shutdown(cb) {
      if (!this._worker) {
        cb("Don't have _worker to trigger shutdown on.");
        return false;
      }
      if (this._shuttingDown) {
        // already shutting down...
        cb("Shutdown already in progress.");
        return false;
      }
      this._shuttingDown = true;
      // A shutdown involves a) stopping listening for new connections and
      // b) transferring our listeners to a different slave

      // tell our server to stop listening
      this.server.close();
      // tell our worker process to transfer out our listeners
      return this._worker.shutdown(cb);
    }

    //----------
    configureStreams(options) {
      var k, key, obj, opts, ref, source, stream;
      this.logger.debug("In configureStreams");
      this.logger.debug("In slave configureStreams with ", {
        options: options
      });
      ref = this.streams;
      // are any of our current streams missing from the new options? if so,
      // disconnect them
      for (k in ref) {
        obj = ref[k];
        if (!(options != null ? options[k] : void 0)) {
          this.logger.debug(`configureStreams: Disconnecting stream ${k}`);
          this.logger.info(`configureStreams: Calling disconnect on ${k}`);
          obj.disconnect();
          delete this.streams[k];
        }
      }
      // run through the streams we've been passed, initializing sources and
      // creating rewind buffers
      this.logger.debug("configureStreams: New options start");
      for (key in options) {
        opts = options[key];
        this.logger.debug(`configureStreams: Configuring ${key}`);
        if (this.streams[key]) {
          // existing stream...  pass it updated configuration
          this.logger.debug(`Passing updated config to stream: ${key}`, {
            opts: opts
          });
          this.streams[key].configure(opts);
        } else {
          this.logger.debug(`Starting up stream: ${key}`, {
            opts: opts
          });
          // FIXME: Eventually it would make sense to allow a per-stream
          // value here
          opts.tz = tz(require("timezone/zones"))(this.config.timezone || "UTC");
          stream = this.streams[key] = new Stream(this, key, this.logger.child({
            stream: key
          }), opts);
          if (this.masterConnection) {
            source = this.socketSource(stream);
            stream.useSource(source);
          }
        }
        // should this stream accept requests to /?
        if (opts.root_route) {
          this.root_route = key;
        }
      }
      // emit a streams event for any components under us that might
      // need to know
      this.logger.debug("Done with configureStreams");
      return this.emit("streams", this.streams);
    }

    //----------

      // Get a status snapshot by looping through each stream to return buffer
    // stats. Lets master know that we're still listening and current
    _streamStatus(cb) {
      var key, ref, s, status, totalConnections, totalKBytes;
      status = {};
      totalKBytes = 0;
      totalConnections = 0;
      ref = this.streams;
      for (key in ref) {
        s = ref[key];
        status[key] = s.status();
        totalKBytes += status[key].kbytes_sent;
        totalConnections += status[key].connections;
      }
      return cb(null, _.extend(status, {
        _stats: {
          kbytes_sent: totalKBytes,
          connections: totalConnections
        }
      }));
    }

    //----------
    socketSource(stream) {
      return new SocketSource(this, stream);
    }

    //----------
    ejectListeners(lFunc, cb) {
      var id, k, obj, ref, ref1, s, sFunc;
      // transfer listeners, one at a time
      this.logger.info("Preparing to eject listeners from slave.");
      this._enqueued = [];
      ref = this.streams;
      // -- prep our listeners -- #
      for (k in ref) {
        s = ref[k];
        this.logger.info(`Preparing ${Object.keys(s._lmeta).length} listeners for ${s.key}`);
        ref1 = s._lmeta;
        for (id in ref1) {
          obj = ref1[id];
          this._enqueued.push([s, obj]);
        }
      }
      if (this._enqueued.length === 0) {
        return typeof cb === "function" ? cb() : void 0;
      }
      // -- now send them one-by-one -- #
      sFunc = () => {
        var d, l, sl, stream;
        sl = this._enqueued.shift();
        if (!sl) {
          this.logger.info("All listeners have been ejected.");
          return cb(null);
        }
        [stream, l] = sl;
        // wrap the listener send in an error domain to try as
        // hard as we can to get it all there
        d = require("domain").create();
        d.on("error", (err) => {
          console.error(`Handoff error: ${err}`);
          this.logger.error(`Eject listener for ${l.id} hit error: ${err}`);
          d.exit();
          return sFunc();
        });
        return d.run(() => {
          return l.obj.prepForHandoff((skipHandoff = false) => {
            var lopts, socket;
            // some listeners don't need handoffs
            if (skipHandoff) {
              return sFunc();
            }
            socket = l.obj.socket;
            lopts = {
              key: [stream.key, l.id].join("::"),
              stream: stream.key,
              id: l.id,
              startTime: l.startTime,
              client: l.obj.client
            };
            // there's a chance that the connection could end
            // after we recorded the id but before we get here.
            // don't send in that case...
            if (socket && !socket.destroyed) {
              return lFunc(lopts, socket, (err) => {
                if (err) {
                  this.logger.error(`Failed to send listener ${lopts.id}: ${err}`);
                }
                // move on to the next one...
                return sFunc();
              });
            } else {
              this.logger.info(`Listener ${lopts.id} perished in the queue. Moving on.`);
              return sFunc();
            }
          });
        });
      };
      return sFunc();
    }

    //----------
    landListener(obj, socket, cb) {
      var output;
      // check and make sure they haven't disconnected mid-flight
      if (socket && !socket.destroyed) {
        // create an output and attach it to the proper stream
        output = new this.Outputs[obj.client.output](this.streams[obj.stream], {
          socket: socket,
          client: obj.client,
          startTime: new Date(obj.startTime)
        });
        return cb(null);
      } else {
        return cb("Listener disconnected in-flight");
      }
    }

  };

  Slave.prototype.Outputs = {
    pumper: require("../outputs/pumper"),
    shoutcast: require("../outputs/shoutcast"),
    raw: require("../outputs/raw_audio")
  };

  return Slave;

}).call(this);

//----------

//# sourceMappingURL=index.js.map
