import {InputConfig, SlaveConfig_V1, SlaveCtx, SlaveStatus, StreamStatus} from "./types";
import {Stream} from "./stream/Stream";
import {StreamsCollection} from "./streams/StreamsCollection";
import {Events} from '../events';
import {EventEmitter} from "events";
import {Logger} from "winston";
import {ListenersConnector} from "./listeners/ListenersConnector";
import {ListenServer} from "./server/ListenServer";
import {MasterConnection} from "./master_io/MasterConnection";
import {AnalyticsReporter} from "./analytics/AnalyticsReporter";

module.exports = class Slave extends EventEmitter {
  private connected = false;
  private configured = false;
  private readonly config: SlaveConfig_V1;
  private readonly logger: Logger;
  private readonly streams = new StreamsCollection()
  private readonly masterConnection: MasterConnection;
  private readonly listenersConnector: ListenersConnector;
  private readonly server: ListenServer;
  private readonly analyticsReporter: AnalyticsReporter;

  constructor(private readonly ctx: SlaveCtx) {
    super();

    this.config = this.ctx.config;
    this.logger = this.ctx.logger.child({
      component: "slave"
    });
    this.logger.info("initialize slave");

    this.masterConnection = new MasterConnection(ctx);
    this.listenersConnector = new ListenersConnector(ctx);
    this.server = new ListenServer(
      this.streams,
      ctx,
    );
    this.analyticsReporter = new AnalyticsReporter(
      this.masterConnection,
      ctx.events,
    );

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

    this.ctx.events.on(Events.Link.CONFIG, (config: InputConfig) => {
      this.configureStreams(config.streams);
    });

    this.ctx.events.on(Events.Link.SLAVE_STATUS, async (cb: (status: SlaveStatus) => void) => {
      cb(this.getStreamStatus());
    });
  }

  /**
   * Add, reconfigure or remove streams
   */
  configureStreams(activeStreams: InputConfig['streams']) {
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
      stream!.configure(config);
    });

    // run through new streams
    this.logger.info(`${streamsToCreate.length} streams to create (${streamsToCreate.join(' / ')})`);
    streamsToCreate.forEach(key => {
      const config = activeStreams[key];
      this.logger.info(`create new stream ${key}`);

      const stream = new Stream(
        key,
        config,
        this.masterConnection,
        this.ctx,
      );

      this.streams.add(key, stream);
    });

    this.logger.info("streams configuration done");
    this.configured = true;

    return this.emit(Events.Slave.STREAMS_UPDATE_OK, this.streams);
  }

  /**
   * Get a status snapshot by looping through each stream to return buffer
   * stats. Lets master know that we're still listening and current
   */
  getStreamStatus(): SlaveStatus {
    const result: { [k: string]: StreamStatus } = {};
    let totalKBytes = 0;
    let totalConnections = 0;

    this.streams.toArray().map((stream: Stream) => {
      const status = stream.status();
      result[stream.getId()] = status;
      totalKBytes += status.stats.kbytesSent;
      totalConnections += status.stats.connections;
    })

    return {
      ...result,
      _stats: {
        kbytes_sent: totalKBytes,
        connections: totalConnections
      }
    } as SlaveStatus;
  }
}
