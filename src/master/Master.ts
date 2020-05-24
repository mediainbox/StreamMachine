import _ from "lodash";
import {EventEmitter} from 'events';
import {MasterConfig} from "./types";
import {StreamsCollection} from "./streams/StreamsCollection";
import { Stream } from "./streams/Stream";
import {Logger} from "winston";

/**
 * Master handles configuration, slaves, incoming sources,
 * logging and the admin interface
 */
export class Master extends EventEmitter {
  private readonly streams: StreamsCollection;

  private readonly logger: Logger;

  constructor(private readonly config: MasterConfig) {
    super();

    this._configured = false;
    this.source_mounts = {};
    this.stream_groups = {};
    this.dataBroadcasters = {};
    this.config = this.ctx.config;
    this.logger = this.ctx.logger.child({
      component: "master"
    });
    this.ctx.events = new EventsHub();
    this.ctx.master = this;
    this.logger.debug("initialize master");



    this.api = new MasterAPI(this.ctx);
    this.sourcein = new SourceIn(this.ctx);
    this.slaveServer = new SlaveServer(this.ctx);


    //this.configure(this.config);


    //if (this.config.rewind_dump && false) {
    //  this.rewind_dr = new RewindDumpRestore(this, this.config.rewind_dump);
    //}

    //this.server.use("/s", this.master.transport.app);
    //this.server.use("/api", this.master.api.app);

    //this.loadRewinds();
    //@handle = @server.listen @opts.master.port
    //@master.slaves.listen(@handle)
    //@master.sourcein.listen()
  }

  hookEvents() {
    this.once(Events.Master.STREAMS_UPDATE, () => {
      return this._configured = true;
    });

    this.on(Events.Master.STREAMS_UPDATE, () => {
      return this.slaveServer.updateConfig(this.getStreamsAndSourceConfig());
    });
  }

  loadRewinds() {
    return this.once(Events.Master.STREAMS_UPDATE, () => {
      this.rewind_dr.load();
    });
  }

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

  // configre can be called on a new core, or it can be called to
  // reconfigure an existing core.  we need to support either one.
  configureStreams(streamsConfig: MasterConfig['streams']) {

    streamsConfig!.forEach(config => {

      const stream = new Stream(
        config.id,
        config, // TODO: inherit config from master
        this.logger.child({
          component: `stream[${config.id}]`
        })
      );

      this.streams.add(config.id, stream);


      //this._attachIOProxy(stream);
      //return this.emit(Events.Master.STREAMS_UPDATE, this.streams);
      //this.emit(Events.Master.NEW_STREAM, stream);
    });



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

  vitals(stream, cb) {
    var s;
    if (s = this.streams[stream]) {
      return s.vitals(cb);
    } else {
      return cb("Invalid Stream");
    }
  }

  status() {
    return {
      streams: this.streamsInfo(),
      sources: this.sourcesInfo()
    };
  }


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
}
