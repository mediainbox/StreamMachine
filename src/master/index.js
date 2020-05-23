const _ = require("lodash");
const temp = require("temp");
const net = require("net");
const fs = require("fs");
const express = require("express");
const Throttle = require("throttle");
const debug = require("debug")("sm:master:index");
const Redis = require("../stores/redis_store");
const MasterConfigRedisStore = require("./config/redis_config");
const MasterAPI = require("./admin/api");
const Stream = require("./streams/stream");
const SourceIn = require("./sources/source_in");
const Alerts = require("../alerts/alerts");
const Analytics = require("../analytics");
const Monitoring = require("./monitoring");
const SlaveServer = require("./slave_io/slave_server");
const SourceMount = require("./sources/source_mount");
const RewindDumpRestore = require("../rewind/dump_restore");
const {Events, EventsHub} = require('../events');
const StreamDataBroadcaster = require('./streams/stream_data_broadcaster');
const { EventEmitter } = require('events');

// A Master handles configuration, slaves, incoming sources, logging and the admin interface
module.exports = class Master extends EventEmitter {
  constructor(ctx) {
    var ref;
    super();
    this.ctx = ctx;
    this._configured = false;
    this.source_mounts = {};
    this.streams = {};
    this.stream_groups = {};
    this.dataBroadcasters = {};
    this.config = this.ctx.config;
    this.logger = this.ctx.logger.child({
      component: "master"
    });
    this.ctx.events = new EventsHub();
    this.ctx.master = this;
    this.logger.debug("initialize master");
    if (this.config.redis != null) {
      // -- load our streams configuration from redis -- #

      // we store streams and sources into Redis, but not our full
      // config object. Other stuff still loads from the config file
      this.logger.debug("initialize Redis connection");
      this.ctx.providers.redis = new Redis(this.config.redis);
      this.configStore = new MasterConfigRedisStore(ctx);
      this.configStore.on("config", (config) => {
        if (config) {
          // stash the configuration
          this.config = _.defaults(config, this.config);
          // (re-)configure our master stream objects
          return this.configure(this.config);
        }
      });
      // Persist changed configuration to Redis
      this.logger.debug("registering config_update listener");
      this.on(Events.Master.CONFIG_UPDATE, () => {
        return this.configStore._update(this.getStreamsAndSourceConfig(), (err) => {
          return this.logger.info(`Redis config update saved: ${err}`);
        });
      });
    } else {
      // -- look for hard-coded configuration -- #
      process.nextTick(() => {
        return this.configure(this.config);
      });
    }
    this.once(Events.Master.STREAMS_UPDATE, () => {
      return this._configured = true;
    });
    // -- create a server to provide the API -- #
    this.api = new MasterAPI(this.ctx);
    // -- create a backend server for stream requests -- #
    this.transport = new StreamTransport(this);
    // -- start the source listener -- #
    this.sourcein = new SourceIn(this.ctx);
    // -- create an alerts object -- #
    this.alerts = new Alerts({
      logger: this.logger.child({
        module: "alerts"
      })
    });
    // -- create a listener for slaves -- #
    if (this.config.master) {
      this.slaveServer = new SlaveServer(this.ctx);
      this.on(Events.Master.STREAMS_UPDATE, () => {
        return this.slaveServer.updateConfig(this.getStreamsAndSourceConfig());
      });
    }

    // -- Analytics -- #
    //this.analytics = new Analytics(this.ctx);

    // -- Rewind Dump and Restore -- #
    if (this.config.rewind_dump && false) {
      this.rewind_dr = new RewindDumpRestore(this, this.config.rewind_dump);
    }
    // -- Set up our monitoring module -- #
    this.monitoring = new Monitoring(this.ctx);
  }

  //----------
  once_configured(cb) {
    if (this._configured) {
      return cb();
    } else {
      return this.once(Events.Master.STREAMS_UPDATE, () => {
        return cb();
      });
    }
  }

  //----------
  loadRewinds(cb) {
    return this.once(Events.Master.STREAMS_UPDATE, () => {
      var ref;
      return (ref = this.rewind_dr) != null ? ref.load(cb) : void 0;
    });
  }

  //----------
  getStreamsAndSourceConfig() {
    var config, k, ref, ref1, s;
    config = {
      streams: {},
      sources: {}
    };
    ref = this.streams;
    for (k in ref) {
      s = ref[k];
      config.streams[k] = s.getConfig();
    }
    ref1 = this.source_mounts;
    for (k in ref1) {
      s = ref1[k];
      config.sources[k] = s.getConfig();
    }
    return config;
  }

  //----------

  // configre can be called on a new core, or it can be called to
  // reconfigure an existing core.  we need to support either one.
  configure(options, cb) {
    var all_keys, k, key, mount, mount_key, new_sources, new_streams, obj, opts, ref, ref1;
    this.logger.debug("configure sources and streams");
    all_keys = {};
    // -- Sources -- #
    new_sources = (options != null ? options.sources : void 0) || {};
    for (k in new_sources) {
      opts = new_sources[k];
      all_keys[k] = 1;
      this.logger.debug(`configure source ${k}`);
      if (this.source_mounts[k]) {
        // existing...
        this.source_mounts[k].configure(opts);
      } else {
        this._startSourceMount(k, opts);
      }
    }
    // -- Streams -- #

    // are any of our current streams missing from the new options? if so,
    // disconnect them
    new_streams = (options != null ? options.streams : void 0) || {};
    ref = this.streams;
    for (k in ref) {
      obj = ref[k];
      if (!(new_streams != null ? new_streams[k] : void 0)) {
        this.logger.debug("calling destroy on ", k);
        obj.destroy();
        delete this.streams[k];
      }
    }
// run through the streams we've been passed, initializing sources and
// creating rewind buffers
    for (key in new_streams) {
      opts = new_streams[key];
      this.logger.debug(`parsing stream for ${key}`);
      // does this stream have a mount?
      mount_key = opts.source || key;
      all_keys[mount_key] = 1;
      if (!this.source_mounts[mount_key]) {
        // create a mount
        this.logger.debug(`Creating an unspecified source mount for ${mount_key} (via ${key}).`);
        this._startSourceMount(mount_key, _(opts).pick('source_password', 'format', 'monitored'));
      }
      mount = this.source_mounts[mount_key];
      // do we need to create the stream?
      if (this.streams[key]) {
        // existing stream...  pass it updated configuration
        this.logger.debug(`passing updated config to stream handler ${key}`, {
          opts: opts
        });
        this.streams[key].configure(opts);
      } else {
        this._startStream(key, mount, opts);
      }
    }
    this.emit(Events.Master.STREAMS_UPDATE, this.streams);
    ref1 = this.source_mounts;
    // -- Remove Old Source Mounts -- #
    for (k in ref1) {
      obj = ref1[k];
      if (!all_keys[k]) {
        this.logger.debug(`Destroying source mount ${k}`);
      }
    }
    return typeof cb === "function" ? cb(null, {
      streams: this.streams,
      sources: this.source_mounts
    }) : void 0;
  }

  //----------
  _startSourceMount(key, opts) {
    var mount;
    mount = new SourceMount(key, this.logger, opts);
    if (mount) {
      this.source_mounts[key] = mount;
      this.emit(Events.Master.NEW_SOURCE_MOUNT, mount);
      return mount;
    } else {
      return false;
    }
  }

  //----------
  _startStream(key, mount, opts) {
    var stream, streamArgs, streamConfig;
    streamConfig = _.extend(opts, {
      preroll: opts.preroll != null ? opts.preroll : this.config.preroll,
      //transcoder: if opts.transcoder? then opts.transcoder else @config.transcoder
      log_interval: opts.log_interval != null ? opts.log_interval : this.config.log_interval
    });
    streamArgs = {
      key: key,
      mount: mount,
      config: streamConfig
    };
    stream = new Stream(this.ctx, streamArgs);
    if (stream) {
      // attach a listener for configs
      stream.on("config", () => {
        this.emit(Events.Master.CONFIG_UPDATE);
        return this.emit(Events.Master.STREAMS_UPDATE, this.streams);
      });
      this.streams[key] = stream;
      this._attachIOProxy(stream);
      this.emit(Events.Master.NEW_STREAM, stream);
      return stream;
    } else {
      return false;
    }
  }

  //----------
  createStream(opts, cb) {
    var mount_key, stream;
    this.logger.debug("createStream called with ", opts);
    if (!opts.key) {
      if (typeof cb === "function") {
        cb("Cannot create stream without key.");
      }
      return false;
    }
    if (this.streams[opts.key]) {
      if (typeof cb === "function") {
        cb("Stream key must be unique.");
      }
      return false;
    }
    // -- Is there a Source Mount? -- #
    mount_key = opts.source || opts.key;
    if (!this.source_mounts[mount_key]) {
      // create a mount
      this.logger.debug(`Creating an unspecified source mount for ${mount_key} (via ${opts.key}).`);
      this._startSourceMount(mount_key, _(opts).pick('source_password', 'format'));
    }
    // -- create the stream -- #
    if (stream = this._startStream(opts.key, this.source_mounts[mount_key], opts)) {
      this.emit(Events.Master.CONFIG_UPDATE);
      this.emit(Events.Master.STREAMS_UPDATE, this.streams);
      return typeof cb === "function" ? cb(null, stream.status()) : void 0;
    } else {
      return typeof cb === "function" ? cb("Stream failed to start.") : void 0;
    }
  }

  //----------
  updateStream(stream, opts, cb) {
    this.logger.info("updateStream called for ", {
      key: stream.key,
      opts: opts
    });
    // -- if they want to rename, the key must be unique -- #
    if (opts.key && stream.key !== opts.key) {
      if (this.streams[opts.key]) {
        if (typeof cb === "function") {
          cb("Stream key must be unique.");
        }
        return false;
      }
      this.streams[opts.key] = stream;
      delete this.streams[stream.key];
    }
    // -- if we're good, ask the stream to configure -- #
    return stream.configure(opts, (err, config) => {
      if (err) {
        if (typeof cb === "function") {
          cb(err);
        }
        return false;
      }
      return typeof cb === "function" ? cb(null, config) : void 0;
    });
  }

  //----------
  removeStream(stream, cb) {
    this.logger.info("removeStream called for ", {
      key: stream.key
    });
    delete this.streams[stream.key];
    stream.destroy();
    this.emit(Events.Master.CONFIG_UPDATE);
    this.emit(Events.Master.STREAMS_UPDATE, this.streams);
    return typeof cb === "function" ? cb(null, "OK") : void 0;
  }

  //----------
  createMount(opts, cb) {
    var mount;
    this.logger.info(`createMount called for ${opts.key}`, {
      opts: opts
    });
    if (!opts.key) {
      if (typeof cb === "function") {
        cb("Cannot create mount without key.");
      }
      return false;
    }
    if (this.source_mounts[opts.key]) {
      if (typeof cb === "function") {
        cb("Mount key must be unique.");
      }
      return false;
    }
    if (mount = this._startSourceMount(opts.key, opts)) {
      this.emit(Events.Master.CONFIG_UPDATE);
      return typeof cb === "function" ? cb(null, mount.status()) : void 0;
    } else {
      return typeof cb === "function" ? cb("Mount failed to start.") : void 0;
    }
  }

  //----------
  updateMount(mount, opts, cb) {
    this.logger.info(`updateMount called for ${mount.key}`, {
      opts: opts
    });
    // -- if they want to rename, the key must be unique -- #
    if (opts.key && mount.key !== opts.key) {
      if (this.source_mounts[opts.key]) {
        if (typeof cb === "function") {
          cb("Mount key must be unique.");
        }
        return false;
      }
      this.source_mounts[opts.key] = mount;
      delete this.source_mounts[mount.key];
    }
    // -- if we're good, ask the mount to configure -- #
    return mount.configure(opts, (err, config) => {
      if (err) {
        return typeof cb === "function" ? cb(err) : void 0;
      }
      return typeof cb === "function" ? cb(null, config) : void 0;
    });
  }

  //----------
  removeMount(mount, cb) {
    this.logger.info(`removeMount called for ${mount.key}`);
    // it's illegal to remove a mount that still has streams hooked up to it
    if (mount.listeners("data").length > 0) {
      cb(new Error("Cannot remove source mount until all streams are removed"));
      return false;
    }
    delete this.source_mounts[mount.key];
    mount.destroy();
    this.emit(Events.Master.CONFIG_UPDATE);
    return cb(null, "OK");
  }

  //----------
  streamsInfo() {
    var k, obj, ref, results;
    ref = this.streams;
    results = [];
    for (k in ref) {
      obj = ref[k];
      results.push(obj.status());
    }
    return results;
  }

  groupsInfo() {
    var k, obj, ref, results;
    ref = this.stream_groups;
    results = [];
    for (k in ref) {
      obj = ref[k];
      results.push(obj.status());
    }
    return results;
  }

  sourcesInfo() {
    var k, obj, ref, results;
    ref = this.source_mounts;
    results = [];
    for (k in ref) {
      obj = ref[k];
      results.push(obj.status());
    }
    return results;
  }

  //----------
  vitals(stream, cb) {
    var s;
    if (s = this.streams[stream]) {
      return s.vitals(cb);
    } else {
      return cb("Invalid Stream");
    }
  }

  //----------
  getHLSSnapshot(stream, cb) {
    var s;
    if (s = this.streams[stream]) {
      return s.getHLSSnapshot(cb);
    } else {
      return cb("Invalid Stream");
    }
  }

  //----------
  status() {
    return {
      streams: this.streamsInfo(),
      groups: this.groupsInfo(),
      sources: this.sourcesInfo()
    };
  }

  //----------

  // Get a status snapshot by looping through each stream to get buffer stats
  _rewindStatus() {
    var key, ref, s, status;
    status = {};
    ref = this.streams;
    for (key in ref) {
      s = ref[key];
      status[key] = s.rewind.getStatus();
    }
    return status;
  }

  //----------
  slavesInfo() {
    var k, s;
    if (this.slaveServer) {
      return {
        slaveCount: Object.keys(this.slaveServer.slaveConnections).length,
        slaves: (function () {
          var ref, results;
          ref = this.slaveServer.slaveConnections;
          results = [];
          for (k in ref) {
            s = ref[k];
            results.push({
              id: k,
              status: s.last_status || "WARMING UP"
            });
          }
          return results;
        }).call(this),
        master: this._rewindStatus()
      };
    } else {
      return {
        slaveCount: 0,
        slaves: [],
        master: this._rewindStatus()
      };
    }
  }

  //----------
  sendHandoffData(rpc, cb) {
    var fFunc;
    fFunc = _.after(2, () => {
      this.logger.info("Rewind buffers and sources sent.");
      return cb(null);
    });
    // -- Source Mounts -- #
    rpc.once("sources", (msg, handle, cb) => {
      var _sendMount, mounts;
      this.logger.info("Received request for sources.");
      // iterate through each source mount, sending each of its sources
      mounts = _.values(this.source_mounts);
      _sendMount = () => {
        var _sendSource, mount, sources;
        mount = mounts.shift();
        if (!mount) {
          cb(null);
          return fFunc();
        }
        sources = mount.sources.slice();
        _sendSource = () => {
          var source;
          source = sources.shift();
          if (!source) {
            return _sendMount();
          }
          this.logger.info(`Sending source ${mount.key}/${source.uuid}`);
          return rpc.request("source", {
            mount: mount.key,
            type: source.HANDOFF_TYPE,
            opts: {
              format: source.opts.format,
              uuid: source.uuid,
              source_ip: source.opts.source_ip,
              connectedAt: source.connectedAt
            }
          }, source.opts.sock, (err, reply) => {
            if (err) {
              this.logger.error(`Error sending source ${mount.key}/${source.uuid}: ${err}`);
            }
            return _sendSource();
          });
        };
        return _sendSource();
      };
      return _sendMount();
    });
    // -- Stream Rewind Buffers -- #
    return rpc.once("stream_rewinds", (msg, handle, cb) => {
      var _sendStream, streams;
      this.logger.info("Received request for rewind buffers.");
      streams = _(this.streams).values();
      _sendStream = () => {
        var _next, sock, spath, stream;
        stream = streams.shift();
        if (!stream) {
          cb(null);
          return fFunc();
        }
        _next = _.once(() => {
          return _sendStream();
        });
        if (stream.rewind.bufferedSecs() > 0) {
          // set up a socket to accept the buffer on
          spath = temp.path({
            suffix: ".sock"
          });
          this.logger.info(`Asking to send rewind buffer for ${stream.key} over ${spath}.`);
          sock = net.createServer();
          return sock.listen(spath, () => {
            sock.once("connection", (c) => {
              return stream.getRewind((err, writer) => {
                if (err) {
                  this.logger.error(`Failed to get rewind buffer for ${stream.key}`);
                  _next();
                }
                writer.pipe(c);
                return writer.once("end", () => {
                  return this.logger.info(`RewindBuffer for ${stream.key} written to socket.`);
                });
              });
            });
            return rpc.request("stream_rewind", {
              key: stream.key,
              path: spath
            }, null, {
              timeout: 10000
            }, (err) => {
              if (err) {
                this.logger.error(`Error sending rewind buffer for ${stream.key}: ${err}`);
              } else {
                this.logger.info(`Rewind buffer sent and ACKed for ${stream.key}`);
              }
              // cleanup...
              return sock.close(() => {
                return fs.unlink(spath, (err) => {
                  this.logger.info("RewindBuffer socket unlinked.", {
                    error: err
                  });
                  return _next();
                });
              });
            });
          });
        } else {
          // no need to send a buffer for an empty stream
          return _next();
        }
      };
      return _sendStream();
    });
  }

  //----------
  loadHandoffData(rpc, cb) {
    var af;
    // -- set up a listener for stream rewinds and sources -- #
    rpc.on("source", (msg, handle, cb) => {
      var mount, source;
      mount = this.source_mounts[msg.mount];
      source = new (require(`./src/sources`))(_.extend({}, msg.opts, {
        sock: handle,
        logger: mount.log
      }));
      mount.addSource(source);
      this.logger.info(`Added mount source: ${mount.key}/${source.uuid}`);
      return cb(null);
    });
    rpc.on("stream_rewind", (msg, handle, cb) => {
      var sock, stream;
      stream = this.streams[msg.key];
      this.logger.info(`Stream Rewind will load over ${msg.path}.`);
      return sock = net.connect(msg.path, (err) => {
        this.logger.info(`Reader socket connected for rewind buffer ${msg.key}`, {
          error: err
        });
        if (err) {
          return cb(err);
        }
        return stream.rewind.loadBuffer(sock, (err, stats) => {
          if (err) {
            this.logger.error(`Error loading rewind buffer: ${err}`);
            cb(err);
          }
          return cb(null);
        });
      });
    });
    af = _.after(2, () => {
      return cb(null);
    });
    // -- Request Sources -- #
    rpc.request("sources", {}, null, {
      timeout: 10000
    }, (err) => {
      if (err) {
        this.logger.error(`Failed to get sources from handoff initiator: ${err}`);
      } else {
        this.logger.info("Received sources from handoff initiator.");
      }
      return af();
    });
    // -- Request Stream Rewind Buffers -- #
    return rpc.request("stream_rewinds", {}, null, {
      timeout: 10000
    }, (err) => {
      if (err) {
        this.logger.error(`Failed to get stream rewinds from handoff initiator: ${err}`);
      } else {
        this.logger.info("Received stream rewinds from handoff initiator.");
      }
      return af();
    });
  }

  //----------
  _attachIOProxy(stream) {
    if (!this.slaveServer) {
      this.logger.warning(`no slaves found to attach stream broadcast for ${stream.key}`);
      return false;
    }
    if (this.dataBroadcasters[stream.key]) {
      this.logger.info(`existing broadcaster found for ${stream.key}`);
      return false;
    }
    // create a new proxy
    this.logger.debug(`create stream broadcaster for ${stream.key}`);
    this.dataBroadcasters[stream.key] = new StreamDataBroadcaster({
      key: stream.key,
      stream: stream,
      master: this
    });
    // and attach a listener to destroy it if the stream is removed
    return stream.once("destroy", () => {
      var ref;
      if ((ref = this.dataBroadcasters[stream.key]) != null) {
        ref.destroy();
      }
      return delete this.dataBroadcasters[stream.key];
    });
  }

};


class StreamTransport {
  constructor(master) {
    this.master = master;
    this.app = express();
    // -- Param Handlers -- #
    this.app.param("stream", (req, res, next, key) => {
      var s;
      // make sure it's a valid stream key
      if ((key != null) && (s = this.master.streams[key])) {
        req.stream = s;
        return next();
      } else {
        return res.status(404).end("Invalid stream.\n");
      }
    });
    // -- Validate slave id -- #
    this.app.use((req, res, next) => {
      var sock_id;
      sock_id = req.get('stream-slave-id');
      if (sock_id && this.master.slaveServer.slaveConnections[sock_id]) {
        //req.slave_socket = @master.slaveServer[ sock_id ]
        return next();
      } else {
        this.master.logger.debug("Rejecting StreamTransport request with missing or invalid socket ID.", {
          sock_id: sock_id
        });
        return res.status(401).end("Missing or invalid socket ID.\n");
      }
    });
    // -- Routes -- #
    this.app.get("/:stream/rewind", (req, res) => {
      this.master.logger.debug(`Rewind Buffer request from slave on ${req.stream.key}.`);
      res.status(200).write('');
      return req.stream.getRewind((err, writer) => {
        writer.pipe(new Throttle(100 * 1024 * 1024)).pipe(res);
        return res.on("end", () => {
          return this.master.logger.debug("Rewind dumpBuffer finished.");
        });
      });
    });
  }

};
