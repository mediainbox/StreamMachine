const _ = require("lodash");
const Stream = require("./streams/stream");
const ListenServer = require("./server/listen_server");
const MasterConnection = require("./master_io/master_connection");
const SocketSource = require("./streams/socket_source");
const { Events, EventsHub } = require('../events');
const StreamsCollection = require("./streams/streams_collection");

module.exports = Slave = (function() {
  class Slave extends require("events").EventEmitter {
    constructor(ctx) {
      super();
      this.ctx = ctx;

      this.connected = false
      this.configured = false;
      this.config = this.ctx.config;

      this.logger = this.ctx.logger.child({
        component: "slave"
      });
      this.logger.debug("initialize slave");

      this.ctx.events = new EventsHub(); // TODO: move to mode?
      this.streams = new StreamsCollection();
      this.masterConnection = new MasterConnection(this.ctx);

      // -- set up our stream server -- #
      this.server = new ListenServer({
        streams: this.streams,
        ctx: this.ctx,
      });

      this.hookEvents();
    }

    hookEvents() {
      this.ctx.events.on(Events.Slave.CONNECTED, () => {
        this.connected = true;
        this.logger.debug("slave is connected to master");
      });

      this.ctx.events.on(Events.Slave.DISCONNECT, () => {
        this.connected = false;
        this.logger.debug("slave is disconnected from master");
      });

      this.ctx.events.on(Events.Slave.CONNECT_ERROR, () => {
        this.logger.error("could not connect to master, shutdown");
        process.exit(1);
      });

      this.ctx.events.on(Events.Link.CONFIG, config => {
        this.configureStreams(config.streams);
      });

      this.ctx.events.on(Events.Link.SLAVE_STATUS, cb => {
        this._streamStatus(cb);
      });
    }

    configureStreams(updatedStreams) {
      this.logger.debug(`configure updated ${updatedStreams.length} streams received from master`, {
        updatedStreams
      });

      const activeStreamsKeys = this.streams.keys();
      const streamsToRemove = activeStreamsKeys.filter(key => !!updatedStreams[key]);
      const streamsToCreate = Object.keys(updatedStreams).filter(key => !activeStreamsKeys.includes(key));
      const streamsToReconfigure = Object.keys(updatedStreams).filter(key => activeStreamsKeys.includes(key));

      // are any of our current streams missing from the new options? if so,
      // disconnect them
      this.logger.info(`${streamsToRemove.length} streams to remove (${streamsToRemove.join(' / ')})`);
      streamsToRemove.forEach(key => {
        this.logger.info(`disconnect old stream ${key}`);
        const stream = this.streams.remove(key);
        stream.disconnect();
      })

      // run through active streams
      this.logger.info(`${streamsToReconfigure.length} streams to reconfigure (${streamsToReconfigure.join(' / ')})`);
      streamsToReconfigure.forEach(key => {
        const config = updatedStreams[key];
        this.logger.info(`update active stream ${key} config`, {
          config
        });

        const stream = this.streams.get(key);
        stream.configure(config);
      });

      // run through new streams
      this.logger.info(`${streamsToCreate.length} streams to create (${streamsToCreate.join(' / ')})`);
      streamsToCreate.forEach(key => {
        const config = updatedStreams[key];
        this.logger.info(`create new stream ${key}`, {
          config
        });

        const stream = new Stream(key, config, this.ctx);
        stream.useSource(new SocketSource(this.masterConnection, stream, this.ctx));
        this.streams.add(key, stream);
      });

      this.logger.debug("streams configuration done");
      this.configured = true;

      return this.emit(Events.Slave.STREAMS_UPDATE_OK, this.streams);
    }

    once_configured(cb) {
      if (this.configured) {
        return cb();
      } else {
        return this.once(Events.Slave.STREAMS_UPDATE_OK, () => {
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

  return Slave;

}).call(this);

//----------
