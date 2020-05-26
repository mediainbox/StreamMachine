import './types/ambient';
import {SlaveStream} from "./stream/Stream";
import {StreamsCollection} from "./streams/StreamsCollection";
import {EventEmitter} from "events";
import {Logger} from "winston";
import {ListenersConnector} from "./listeners/ListenersConnector";
import {ListenServer} from "./server/ListenServer";
import {MasterConnection} from "./master_io/MasterConnection";
import {AnalyticsReporter} from "./analytics/AnalyticsReporter";
import {buildHttpServer} from "./server/HttpServer";
import express from "express";
import {componentLogger, createLogger} from "../logger";
import _ from "lodash";
import {SlaveConfig} from "./config/types";
import {SlaveEvent, slaveEvents} from "./events";
import {validateConfig} from "./types/config";
import {SlaveStreamsConfig} from "./types/streams";

export class Slave extends EventEmitter {
  private connected = false;
  private configured = false;

  private readonly logger: Logger;
  private readonly streams: StreamsCollection;
  private readonly masterConnection: MasterConnection;
  private readonly listenersConnector: ListenersConnector;
  private readonly listenServer: ListenServer;
  private readonly analyticsReporter: AnalyticsReporter;

  private readonly app: express.Application;
  private readonly config: SlaveConfig;

  constructor(_config: SlaveConfig) {
    super();

    const config = this.config = validateConfig(_config);

    createLogger('slave', config.log);
    this.logger = componentLogger('slave');

    this.logger.info("Initialize slave");

    this.masterConnection = new MasterConnection({
      slaveId: config.slaveId,
      ...config.master
    });

    this.streams = new StreamsCollection();
    this.listenersConnector = new ListenersConnector();
    this.analyticsReporter = new AnalyticsReporter(this.masterConnection);

    this.listenServer = new ListenServer(
      config.server,
      this.streams,
    );

    // setup server related components
    this.app = express();
    buildHttpServer(this.app, config);
    this.app.use(this.listenServer.getApp())

    this.hookEvents();
  }

  hookEvents() {
    slaveEvents().on(SlaveEvent.CONNECT, () => {
      this.connected = true;
      this.logger.info("Slave connected to master");
    });

    slaveEvents().on(SlaveEvent.DISCONNECT, () => {
      this.connected = false;
      this.logger.info("Slave disconnected from master");
    });

    slaveEvents().on(SlaveEvent.CONNECT_ERROR, error => {
      this.logger.error("Could not connect to master, shutdown", {
        error
      });
      process.exit(1);
    });

    slaveEvents().on(SlaveEvent.CONFIGURE_STREAMS, (config: SlaveStreamsConfig) => {
      this.configureStreams(config);
    });

    /*slaveEvents()().on(Events.Link.SLAVE_STATUS, async (cb: (status: SlaveStatus) => void) => {
      cb(this.getStreamStatus());
    });*/
  }

  /**
   * Add, reconfigure or remove streams
   */
  configureStreams(streamsConfig: SlaveStreamsConfig) {
    this.logger.info(`configure ${streamsConfig.length} streams`, {
      streamsConfig
    });

    const activeStreamsIds = this.streams.keys();
    const passedStreamsIds = streamsConfig.map(c => c.id);

    streamsConfig.forEach(streamConfig => {
      const toCreate = !activeStreamsIds.includes(streamConfig.id);

      if (toCreate) {
        this.logger.info(`create new stream ${streamConfig.id}`);

        const stream = new SlaveStream(
          streamConfig.id,
          streamConfig,
          this.masterConnection,
        );

        this.streams.add(streamConfig.id, stream);
      } else {
        this.logger.info(`reconfigure stream ${streamConfig.id}`);

        const stream = this.streams.get(streamConfig.id);
        //stream.reconfigure(config);
      }
    });

    const idsToDelete = _.difference(activeStreamsIds, passedStreamsIds);
    idsToDelete.forEach(id => {
      this.logger.info(`delete stream ${id}`);

      const stream = this.streams.remove(id);
      stream.destroy();
    })

    this.logger.info("streams configuration done");
    //this.configured = true;
  }

  /**
   * Get a status snapshot by looping through each stream to return buffer
   * stats. Lets master know that we're still listening and current
   */
  /*getStreamStatus(): SlaveStatus {
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
  }*/
}
