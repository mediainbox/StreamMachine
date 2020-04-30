var API, Alerts, Analytics, Master, Monitoring, Redis, RedisConfig, RewindDumpRestore, SlaveIO, SourceIn, SourceMount, Stream, Throttle, debug, express, fs, net, temp, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

_ = require("underscore");

temp = require("temp");

net = require("net");

fs = require("fs");

express = require("express");

Throttle = require("throttle");

debug = require("debug")("sm:master:index");

Redis = require("../redis");

RedisConfig = require("../redis_config");

API = require("./admin/api");

Stream = require("./stream");

SourceIn = require("./source_in");

Alerts = require("../alerts");

Analytics = require("../analytics");

Monitoring = require("./monitoring");

SlaveIO = require("./master_io");

SourceMount = require("./source_mount");

RewindDumpRestore = require("../rewind/dump_restore");

module.exports = Master = (function(_super) {
  __extends(Master, _super);

  function Master(options) {
    var _ref, _ref1;
    this.options = options;
    this._configured = false;
    this.source_mounts = {};
    this.streams = {};
    this.stream_groups = {};
    this.proxies = {};
    this.log = this.options.logger;
    if (this.options.redis != null) {
      this.log.debug("Initializing Redis connection");
      this.redis = new Redis(this.options.redis);
      this.redis_config = new RedisConfig(this.redis);
      this.redis_config.on("config", (function(_this) {
        return function(config) {
          if (config) {
            _this.options = _.defaults(config, _this.options);
            return _this.configure(_this.options);
          }
        };
      })(this));
      this.log.debug("Registering config_update listener");
      this.on("config_update", (function(_this) {
        return function() {
          return _this.redis_config._update(_this.config(), function(err) {
            return _this.log.info("Redis config update saved: " + err);
          });
        };
      })(this));
    } else {
      process.nextTick((function(_this) {
        return function() {
          return _this.configure(_this.options);
        };
      })(this));
    }
    this.once("streams", (function(_this) {
      return function() {
        return _this._configured = true;
      };
    })(this));
    this.api = new API(this, (_ref = this.options.admin) != null ? _ref.require_auth : void 0);
    this.transport = new Master.StreamTransport(this);
    this.sourcein = new SourceIn({
      core: this,
      port: this.options.source_port,
      behind_proxy: this.options.behind_proxy
    });
    this.alerts = new Alerts({
      logger: this.log.child({
        module: "alerts"
      })
    });
    if (this.options.master) {
      this.slaves = new SlaveIO(this, this.log.child({
        module: "master_io"
      }), this.options.master);
      this.on("streams", (function(_this) {
        return function() {
          return _this.slaves.updateConfig(_this.config());
        };
      })(this));
    }
    if ((_ref1 = this.options.analytics) != null ? _ref1.es_uri : void 0) {
      this.analytics = new Analytics({
        config: this.options.analytics,
        log: this.log.child({
          module: "analytics"
        }),
        redis: this.redis
      });
      this.log.logger.add(new Analytics.LogTransport(this.analytics), {}, true);
    }
    if (this.options.rewind_dump) {
      this.rewind_dr = new RewindDumpRestore(this, this.options.rewind_dump);
    }
    this.monitoring = new Monitoring(this, this.log.child({
      module: "monitoring"
    }));
  }

  Master.prototype.once_configured = function(cb) {
    if (this._configured) {
      return cb();
    } else {
      return this.once("streams", (function(_this) {
        return function() {
          return cb();
        };
      })(this));
    }
  };

  Master.prototype.loadRewinds = function(cb) {
    return this.once("streams", (function(_this) {
      return function() {
        var _ref;
        return (_ref = _this.rewind_dr) != null ? _ref.load(cb) : void 0;
      };
    })(this));
  };

  Master.prototype.config = function() {
    var config, k, s, _ref, _ref1;
    config = {
      streams: {},
      sources: {}
    };
    _ref = this.streams;
    for (k in _ref) {
      s = _ref[k];
      config.streams[k] = s.config();
    }
    _ref1 = this.source_mounts;
    for (k in _ref1) {
      s = _ref1[k];
      config.sources[k] = s.config();
    }
    return config;
  };

  Master.prototype.configure = function(options, cb) {
    var all_keys, g, k, key, mount, mount_key, new_sources, new_streams, obj, opts, sg, _base, _ref, _ref1;
    all_keys = {};
    new_sources = (options != null ? options.sources : void 0) || {};
    for (k in new_sources) {
      opts = new_sources[k];
      all_keys[k] = 1;
      this.log.debug("Configuring Source Mapping " + k);
      if (this.source_mounts[k]) {
        this.source_mounts[k].configure(opts);
      } else {
        this._startSourceMount(k, opts);
      }
    }
    new_streams = (options != null ? options.streams : void 0) || {};
    _ref = this.streams;
    for (k in _ref) {
      obj = _ref[k];
      if (!(new_streams != null ? new_streams[k] : void 0)) {
        this.log.debug("calling destroy on ", k);
        obj.destroy();
        delete this.streams[k];
      }
    }
    for (key in new_streams) {
      opts = new_streams[key];
      this.log.debug("Parsing stream for " + key);
      mount_key = opts.source || key;
      all_keys[mount_key] = 1;
      if (!this.source_mounts[mount_key]) {
        this.log.debug("Creating an unspecified source mount for " + mount_key + " (via " + key + ").");
        this._startSourceMount(mount_key, _(opts).pick('source_password', 'format', 'monitored'));
      }
      mount = this.source_mounts[mount_key];
      if (this.streams[key]) {
        this.log.debug("Passing updated config to master stream: " + key, {
          opts: opts
        });
        this.streams[key].configure(opts);
      } else {
        this.log.debug("Starting up master stream: " + key, {
          opts: opts
        });
        this._startStream(key, mount, opts);
      }
      if (g = this.streams[key].opts.group) {
        sg = ((_base = this.stream_groups)[g] || (_base[g] = new Stream.StreamGroup(g, this.log.child({
          stream_group: g
        }))));
        sg.addStream(this.streams[key]);
      }
    }
    this.emit("streams", this.streams);
    _ref1 = this.source_mounts;
    for (k in _ref1) {
      obj = _ref1[k];
      if (!all_keys[k]) {
        this.log.debug("Destroying source mount " + k);
      }
    }
    return typeof cb === "function" ? cb(null, {
      streams: this.streams,
      sources: this.source_mounts
    }) : void 0;
  };

  Master.prototype._startSourceMount = function(key, opts) {
    var mount;
    mount = new SourceMount(key, this.log.child({
      source_mount: key
    }), opts);
    if (mount) {
      this.source_mounts[key] = mount;
      this.emit("new_source_mount", mount);
      return mount;
    } else {
      return false;
    }
  };

  Master.prototype._startStream = function(key, mount, opts) {
    var stream;
    stream = new Stream(key, this.log.child({
      stream: key
    }), mount, _.extend(opts, {
      hls: this.options.hls,
      preroll: opts.preroll != null ? opts.preroll : this.options.preroll,
      transcoder: opts.transcoder != null ? opts.transcoder : this.options.transcoder,
      log_interval: opts.log_interval != null ? opts.log_interval : this.options.log_interval
    }));
    if (stream) {
      stream.on("config", (function(_this) {
        return function() {
          _this.emit("config_update");
          return _this.emit("streams", _this.streams);
        };
      })(this));
      this.streams[key] = stream;
      this._attachIOProxy(stream);
      this.emit("new_stream", stream);
      return stream;
    } else {
      return false;
    }
  };

  Master.prototype.createStream = function(opts, cb) {
    var mount_key, stream;
    this.log.debug("createStream called with ", opts);
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
    mount_key = opts.source || opts.key;
    if (!this.source_mounts[mount_key]) {
      this.log.debug("Creating an unspecified source mount for " + mount_key + " (via " + opts.key + ").");
      this._startSourceMount(mount_key, _(opts).pick('source_password', 'format'));
    }
    if (stream = this._startStream(opts.key, this.source_mounts[mount_key], opts)) {
      this.emit("config_update");
      this.emit("streams", this.streams);
      return typeof cb === "function" ? cb(null, stream.status()) : void 0;
    } else {
      return typeof cb === "function" ? cb("Stream failed to start.") : void 0;
    }
  };

  Master.prototype.updateStream = function(stream, opts, cb) {
    this.log.info("updateStream called for ", {
      key: stream.key,
      opts: opts
    });
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
    return stream.configure(opts, (function(_this) {
      return function(err, config) {
        if (err) {
          if (typeof cb === "function") {
            cb(err);
          }
          return false;
        }
        return typeof cb === "function" ? cb(null, config) : void 0;
      };
    })(this));
  };

  Master.prototype.removeStream = function(stream, cb) {
    this.log.info("removeStream called for ", {
      key: stream.key
    });
    delete this.streams[stream.key];
    stream.destroy();
    this.emit("config_update");
    this.emit("streams", this.streams);
    return typeof cb === "function" ? cb(null, "OK") : void 0;
  };

  Master.prototype.createMount = function(opts, cb) {
    var mount;
    this.log.info("createMount called for " + opts.key, {
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
      this.emit("config_update");
      return typeof cb === "function" ? cb(null, mount.status()) : void 0;
    } else {
      return typeof cb === "function" ? cb("Mount failed to start.") : void 0;
    }
  };

  Master.prototype.updateMount = function(mount, opts, cb) {
    this.log.info("updateMount called for " + mount.key, {
      opts: opts
    });
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
    return mount.configure(opts, (function(_this) {
      return function(err, config) {
        if (err) {
          return typeof cb === "function" ? cb(err) : void 0;
        }
        return typeof cb === "function" ? cb(null, config) : void 0;
      };
    })(this));
  };

  Master.prototype.removeMount = function(mount, cb) {
    this.log.info("removeMount called for " + mount.key);
    if (mount.listeners("data").length > 0) {
      cb(new Error("Cannot remove source mount until all streams are removed"));
      return false;
    }
    delete this.source_mounts[mount.key];
    mount.destroy();
    this.emit("config_update");
    return cb(null, "OK");
  };

  Master.prototype.streamsInfo = function() {
    var k, obj, _ref, _results;
    _ref = this.streams;
    _results = [];
    for (k in _ref) {
      obj = _ref[k];
      _results.push(obj.status());
    }
    return _results;
  };

  Master.prototype.groupsInfo = function() {
    var k, obj, _ref, _results;
    _ref = this.stream_groups;
    _results = [];
    for (k in _ref) {
      obj = _ref[k];
      _results.push(obj.status());
    }
    return _results;
  };

  Master.prototype.sourcesInfo = function() {
    var k, obj, _ref, _results;
    _ref = this.source_mounts;
    _results = [];
    for (k in _ref) {
      obj = _ref[k];
      _results.push(obj.status());
    }
    return _results;
  };

  Master.prototype.vitals = function(stream, cb) {
    var s;
    if (s = this.streams[stream]) {
      return s.vitals(cb);
    } else {
      return cb("Invalid Stream");
    }
  };

  Master.prototype.getHLSSnapshot = function(stream, cb) {
    var s;
    if (s = this.streams[stream]) {
      return s.getHLSSnapshot(cb);
    } else {
      return cb("Invalid Stream");
    }
  };

  Master.prototype.status = function() {
    return {
      streams: this.streamsInfo(),
      groups: this.groupsInfo(),
      sources: this.sourcesInfo()
    };
  };

  Master.prototype._rewindStatus = function() {
    var key, s, status, _ref;
    status = {};
    _ref = this.streams;
    for (key in _ref) {
      s = _ref[key];
      status[key] = s.rewind._rStatus();
    }
    return status;
  };

  Master.prototype.slavesInfo = function() {
    var k, s;
    if (this.slaves) {
      return {
        slaveCount: Object.keys(this.slaves.slaves).length,
        slaves: (function() {
          var _ref, _ref1, _ref2, _ref3, _results;
          _ref = this.slaves.slaves;
          _results = [];
          for (k in _ref) {
            s = _ref[k];
            _results.push({
              id: k,
              status: s.last_status || "WARMING UP",
              connected_at: s.connected_at,
              address: (_ref1 = s.sock) != null ? (_ref2 = _ref1.handshake) != null ? _ref2.address : void 0 : void 0,
              connectionUrl: (_ref3 = s.sock.handshake) != null ? _ref3.url : void 0
            });
          }
          return _results;
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
  };

  Master.prototype.sendHandoffData = function(rpc, cb) {
    var fFunc;
    fFunc = _.after(2, (function(_this) {
      return function() {
        _this.log.info("Rewind buffers and sources sent.");
        return cb(null);
      };
    })(this));
    rpc.once("sources", (function(_this) {
      return function(msg, handle, cb) {
        var mounts, _sendMount;
        _this.log.info("Received request for sources.");
        mounts = _.values(_this.source_mounts);
        _sendMount = function() {
          var mount, sources, _sendSource;
          mount = mounts.shift();
          if (!mount) {
            cb(null);
            return fFunc();
          }
          sources = mount.sources.slice();
          _sendSource = function() {
            var source;
            source = sources.shift();
            if (!source) {
              return _sendMount();
            }
            _this.log.info("Sending source " + mount.key + "/" + source.uuid);
            return rpc.request("source", {
              mount: mount.key,
              type: source.HANDOFF_TYPE,
              opts: {
                format: source.opts.format,
                uuid: source.uuid,
                source_ip: source.opts.source_ip,
                connectedAt: source.connectedAt
              }
            }, source.opts.sock, function(err, reply) {
              if (err) {
                _this.log.error("Error sending source " + mount.key + "/" + source.uuid + ": " + err);
              }
              return _sendSource();
            });
          };
          return _sendSource();
        };
        return _sendMount();
      };
    })(this));
    return rpc.once("stream_rewinds", (function(_this) {
      return function(msg, handle, cb) {
        var streams, _sendStream;
        _this.log.info("Received request for rewind buffers.");
        streams = _(_this.streams).values();
        _sendStream = function() {
          var sock, spath, stream, _next;
          stream = streams.shift();
          if (!stream) {
            cb(null);
            return fFunc();
          }
          _next = _.once(function() {
            return _sendStream();
          });
          if (stream.rewind.bufferedSecs() > 0) {
            spath = temp.path({
              suffix: ".sock"
            });
            _this.log.info("Asking to send rewind buffer for " + stream.key + " over " + spath + ".");
            sock = net.createServer();
            return sock.listen(spath, function() {
              sock.once("connection", function(c) {
                return stream.getRewind(function(err, writer) {
                  if (err) {
                    _this.log.error("Failed to get rewind buffer for " + stream.key);
                    _next();
                  }
                  writer.pipe(c);
                  return writer.once("end", function() {
                    return _this.log.info("RewindBuffer for " + stream.key + " written to socket.");
                  });
                });
              });
              return rpc.request("stream_rewind", {
                key: stream.key,
                path: spath
              }, null, {
                timeout: 10000
              }, function(err) {
                if (err) {
                  _this.log.error("Error sending rewind buffer for " + stream.key + ": " + err);
                } else {
                  _this.log.info("Rewind buffer sent and ACKed for " + stream.key);
                }
                return sock.close(function() {
                  return fs.unlink(spath, function(err) {
                    _this.log.info("RewindBuffer socket unlinked.", {
                      error: err
                    });
                    return _next();
                  });
                });
              });
            });
          } else {
            return _next();
          }
        };
        return _sendStream();
      };
    })(this));
  };

  Master.prototype.loadHandoffData = function(rpc, cb) {
    var af;
    rpc.on("source", (function(_this) {
      return function(msg, handle, cb) {
        var mount, source;
        mount = _this.source_mounts[msg.mount];
        source = new (require("../sources/" + msg.type))(_.extend({}, msg.opts, {
          sock: handle,
          logger: mount.log
        }));
        mount.addSource(source);
        _this.log.info("Added mount source: " + mount.key + "/" + source.uuid);
        return cb(null);
      };
    })(this));
    rpc.on("stream_rewind", (function(_this) {
      return function(msg, handle, cb) {
        var sock, stream;
        stream = _this.streams[msg.key];
        _this.log.info("Stream Rewind will load over " + msg.path + ".");
        return sock = net.connect(msg.path, function(err) {
          _this.log.info("Reader socket connected for rewind buffer " + msg.key, {
            error: err
          });
          if (err) {
            return cb(err);
          }
          return stream.rewind.loadBuffer(sock, function(err, stats) {
            if (err) {
              _this.log.error("Error loading rewind buffer: " + err);
              cb(err);
            }
            return cb(null);
          });
        });
      };
    })(this));
    af = _.after(2, (function(_this) {
      return function() {
        return cb(null);
      };
    })(this));
    rpc.request("sources", {}, null, {
      timeout: 10000
    }, (function(_this) {
      return function(err) {
        if (err) {
          _this.log.error("Failed to get sources from handoff initiator: " + err);
        } else {
          _this.log.info("Received sources from handoff initiator.");
        }
        return af();
      };
    })(this));
    return rpc.request("stream_rewinds", {}, null, {
      timeout: 10000
    }, (function(_this) {
      return function(err) {
        if (err) {
          _this.log.error("Failed to get stream rewinds from handoff initiator: " + err);
        } else {
          _this.log.info("Received stream rewinds from handoff initiator.");
        }
        return af();
      };
    })(this));
  };

  Master.prototype._attachIOProxy = function(stream) {
    this.log.debug("attachIOProxy call for " + stream.key + ".", {
      slaves: this.slaves != null,
      proxy: this.proxies[stream.key] != null
    });
    if (!this.slaves) {
      return false;
    }
    if (this.proxies[stream.key]) {
      return false;
    }
    this.log.debug("Creating StreamProxy for " + stream.key);
    this.proxies[stream.key] = new Master.StreamProxy({
      key: stream.key,
      stream: stream,
      master: this
    });
    return stream.once("destroy", (function(_this) {
      return function() {
        var _ref;
        if ((_ref = _this.proxies[stream.key]) != null) {
          _ref.destroy();
        }
        return delete _this.proxies[stream.key];
      };
    })(this));
  };

  Master.StreamTransport = (function() {
    function StreamTransport(master) {
      this.master = master;
      this.app = express();
      this.app.param("stream", (function(_this) {
        return function(req, res, next, key) {
          var s;
          if ((key != null) && (s = _this.master.streams[key])) {
            req.stream = s;
            return next();
          } else {
            return res.status(404).end("Invalid stream.\n");
          }
        };
      })(this));
      this.app.use((function(_this) {
        return function(req, res, next) {
          var sock_id;
          sock_id = req.get('stream-slave-id');
          if (sock_id && _this.master.slaves.slaves[sock_id]) {
            return next();
          } else {
            _this.master.log.debug("Rejecting StreamTransport request with missing or invalid socket ID.", {
              sock_id: sock_id
            });
            return res.status(401).end("Missing or invalid socket ID.\n");
          }
        };
      })(this));
      this.app.get("/:stream/rewind", (function(_this) {
        return function(req, res) {
          _this.master.log.debug("Rewind Buffer request from slave on " + req.stream.key + ".");
          res.status(200).write('');
          return req.stream.getRewind(function(err, writer) {
            writer.pipe(new Throttle(100 * 1024 * 1024)).pipe(res);
            return res.on("end", function() {
              return _this.master.log.debug("Rewind dumpBuffer finished.");
            });
          });
        };
      })(this));
    }

    return StreamTransport;

  })();

  Master.StreamProxy = (function(_super1) {
    __extends(StreamProxy, _super1);

    function StreamProxy(opts) {
      this.key = opts.key;
      this.stream = opts.stream;
      this.master = opts.master;
      this.dataFunc = (function(_this) {
        return function(chunk) {
          return _this.master.slaves.broadcastAudio(_this.key, chunk);
        };
      })(this);
      this.hlsSnapFunc = (function(_this) {
        return function(snapshot) {
          return _this.master.slaves.broadcastHLSSnapshot(_this.key, snapshot);
        };
      })(this);
      this.stream.on("data", this.dataFunc);
      this.stream.on("hls_snapshot", this.hlsSnapFunc);
    }

    StreamProxy.prototype.destroy = function() {
      this.stream.removeListener("data", this.dataFunc);
      this.stream.removeListener("hls_snapshot", this.hlsSnapFunc);
      this.stream = null;
      this.emit("destroy");
      return this.removeAllListeners();
    };

    return StreamProxy;

  })(require("events").EventEmitter);

  return Master;

})(require("events").EventEmitter);

//# sourceMappingURL=index.js.map
