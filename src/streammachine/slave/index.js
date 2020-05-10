const _ = require("lodash");
const Stream = require("./streams/stream");
const ListenServer = require("./server/listen_server");
const MasterConnection = require("./master_io/master_connection");
const { Events, EventsHub } = require('../events');
const StreamsCollection = require("./streams/streams_collection");
const { EventEmitter } = require("events");
const ListenersHandler = require("./listeners/handler");

module.exports = class Slave extends EventEmitter {
  constructor(ctx) {
    super();

    this.ctx = ctx;
    this.connected = false
    this.configured = false;
    this.config = this.ctx.config;

    this.logger = this.ctx.logger.child({
      component: "slave"
    });
    this.logger.info("initialize slave");

    this.ctx.events = new EventsHub(); // TODO: move to mode?
    this.streams = new StreamsCollection();
    this.masterConnection = new MasterConnection(this.ctx);
    this.listenersHandler = new ListenersHandler({ ctx });

    this.server = new ListenServer({
      streams: this.streams,
      ctx: this.ctx,
    });

    this.hookEvents();
  }

  hookEvents() {
    this.ctx.events.on(Events.Slave.CONNECTED, () => {
      this.connected = true;
      this.logger.info("slave is connected to master");
    });

    this.ctx.events.on(Events.Slave.DISCONNECT, () => {
      this.connected = false;
      this.logger.info("slave is disconnected from master");
    });

    this.ctx.events.on(Events.Slave.CONNECT_ERROR, () => {
      this.logger.error("could not connect to master, shutdown");
      process.exit(1);
    });

    this.ctx.events.on(Events.Link.CONFIG, config => {
      this.configureStreams(config.streams);
    });

    this.ctx.events.on(Events.Link.SLAVE_STATUS, cb => {
      this.getStreamStatus(cb);
    });
  }

  configureStreams(activeStreams) {
    this.logger.info(`configure updated ${activeStreams.length} streams received from master`, {
      updatedStreams: activeStreams
    });

    const activeStreamsKeys = this.streams.keys();
    const streamsToRemove = activeStreamsKeys.filter(key => !activeStreams[key]);
    const streamsToCreate = Object.keys(activeStreams).filter(key => !activeStreamsKeys.includes(key));
    const streamsToReconfigure = Object.keys(activeStreams).filter(key => activeStreamsKeys.includes(key));

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
      const config = activeStreams[key];
      this.logger.info(`update active stream ${key} config`, {
        config
      });

      const stream = this.streams.get(key);
      stream.configure(config);
    });

    // run through new streams
    this.logger.info(`${streamsToCreate.length} streams to create (${streamsToCreate.join(' / ')})`);
    streamsToCreate.forEach(key => {
      const config = activeStreams[key];
      this.logger.info(`create new stream ${key}`, {
        config
      });

      const stream = new Stream({
        key,
        config,
        masterConnection: this.masterConnection,
        ctx: this.ctx,
      });

      this.streams.add(key, stream);
    });

    this.logger.info("streams configuration done");
    this.configured = true;

    return this.emit(Events.Slave.STREAMS_UPDATE_OK, this.streams);
  }

  // Get a status snapshot by looping through each stream to return buffer
  // stats. Lets master know that we're still listening and current
  getStreamStatus(cb) {
    const result = {};
    let totalKBytes = 0;
    let totalConnections = 0;

    this.streams.toArray().map(stream => {
      const status = stream.status();
      result[stream.key] = status;
      totalKBytes += status.kbytes_sent;
      totalConnections += status.connections;
    })

    cb(null, {
      ...result,
      _stats: {
        kbytes_sent: totalKBytes,
        connections: totalConnections
      }
    });
  }
}
