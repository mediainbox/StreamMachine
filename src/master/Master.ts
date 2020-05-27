import './types/ambient';
import {EventEmitter} from 'events';
import {StreamsCollection} from "./streams/StreamsCollection";
import {MasterStream} from "./stream/Stream";
import {Logger} from "winston";
import {componentLogger, createLogger} from "../logger";
import {SlaveServer} from "./slave_io/SlaveServer";
import * as http from "http";
import express from "express";
import {RewindGateway} from "./slave_io/RewindGateway";
import {validateMasterConfig, validateStreamConfig} from "./config";
import {ConfigProviderConfig, MasterConfig, MasterStreamConfig} from "./types/config";
import {makeConfigProvider} from "./config/configProviderFactory";
import {IConfigProvider} from "./config/IConfigProvider";
import _ from "lodash";
import {slaveEvents} from "../slave/events";
import {MasterEvent, masterEvents} from "./events";

/**
 * Master handles configuration, slaves, incoming sources,
 * logging and the admin interface
 */
export class Master extends EventEmitter {
  private logger: Logger = null!;
  private slaveServer?: SlaveServer;
  private httpServer?: http.Server;
  private config?: MasterConfig;
  private configProvider: IConfigProvider;

  private streams = new StreamsCollection();

  constructor(pConfig: ConfigProviderConfig) {
    super();

    this.configProvider = makeConfigProvider(pConfig);
    this.configProvider.read().then(config => this.configure(config));
    this.configProvider.on('update', config => this.onConfigUpdate(config));
  }

  configure(_config: MasterConfig) {
    const config = this.config = validateMasterConfig(_config);

    createLogger('master', config.log);
    this.logger = componentLogger("master");

    this.logger.info("Initialize master");

    const app = express();
    this.httpServer = app.listen(config.server.port);

    //this.api = new MasterAPI(this.ctx);
    //this.sourcein = new SourceIn(this.ctx);

    this.slaveServer = new SlaveServer(
      this.streams,
      {
        password: config.slavesServer.password
      },
    );
    this.slaveServer.listen(this.httpServer);

    const rewindGateway = new RewindGateway(
      this.streams,
      {
        password: config.slavesServer.password,
      }
    );
    app.use(rewindGateway.getApp());

    //this.configure(this.config);

    //if (this.config.rewind_dump && false) {
    //  this.rewind_dr = new RewindDumpRestore(this, this.config.rewind_dump);
    //}

    //this.server.use("/s", this.master.transport.app);
    //this.server.use("/api", this.master.api.app);

    this.configureStreams();
  }

  hookEvents() {
    /*this.once(Events.Master.STREAMS_UPDATE, () => {
      return this._configured = true;
    });

    this.on(Events.Master.STREAMS_UPDATE, () => {
      return this.slaveServer.updateConfig(this.getStreamsAndSourceConfig());
    });*/
  }

  loadRewinds() {
    /*return this.once(Events.Master.STREAMS_UPDATE, () => {
      this.rewind_dr.load();
    });*/
  }

  configureStreams() {
    this.config?.streams.forEach(_config => {
      const config = validateStreamConfig(_config);

      if (!config.enabled) {
        return;
      }

      if (!this.streams.exists(config.id)) {
        this.logger.info(`Create stream ${config.id}`);

        const stream = new MasterStream(
          config.id,
          config, // TODO: inherit config from default
        );

        this.streams.add(config.id, stream);
        masterEvents().emit(MasterEvent.STREAM_CREATED, stream);
      } else {
        const stream = this.streams.get(config.id)!;
        const oldConfig = stream.getConfig();

        if (_.isEqual(config, oldConfig)) {
          this.logger.info(`No change for stream ${config.id}`);
          return;
        }

        this.logger.info(`Update stream ${config.id}`);
        stream.configure(config);
        masterEvents().emit(MasterEvent.STREAM_UPDATED, stream, oldConfig);
      }
    });

    const deletedStreams = this
      .streams
      .toArray()
      .filter(s => {
        const passedConfig = this.config?.streams.find(_s => _s.id === s.getId());
        const missing = !passedConfig;
        const disabled = passedConfig?.enabled === false;

        return missing || disabled;
      });

    deletedStreams.forEach(stream => {
      this.logger.info(`Delete stream ${stream.getId()}`);
      this.streams.remove(stream.getId());
      stream.destroy();

      masterEvents().emit(MasterEvent.STREAM_DELETED, stream);
    });
  }

  onConfigUpdate(newConfig: MasterConfig) {
    this.logger.info('Received new config, check for updates');

    if (_.isEqual(this.config, newConfig)) {
      this.logger.info('Config has not changed');
      return;
    }

    // TODO: validate
    this.config = newConfig;

    if (_.isEqual(this.config?.streams, newConfig.streams)) {
      this.logger.info('Streams config has changed, run update');
      this.configureStreams();
      return;
    }

    this.logger.info('Config updated');
  }
}
