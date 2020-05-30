import './types/ambient';
import {StreamsCollection} from "./streams/StreamsCollection";
import {Logger} from "winston";
import {componentLogger, createLogger} from "../logger";
import {SlaveServer} from "./slave_io/SlaveServer";
import * as http from "http";
import express from "express";
import {RewindGateway} from "./slave_io/RewindGateway";
import _ from "lodash";
import {StreamsUpdater} from "./streams/StreamsUpdater";
import {IConfigurable} from "../config/IConfigurable";
import {MasterConfig} from "./config";

/**
 * Master handles configuration, slaves, incoming sources,
 * logging and the admin interface
 */
export class Master implements IConfigurable<MasterConfig> {
  private logger: Logger = null!;
  private slaveServer?: SlaveServer;
  private httpServer?: http.Server;

  private streams = new StreamsCollection();
  private streamsUpdater?: StreamsUpdater;

  constructor(private config: MasterConfig) {
    createLogger('master', config.log);
    this.logger = componentLogger("master");

    this.logger.info("Initialize master", {
      config,
    });

    const app = express();
    this.httpServer = app.listen(config.server.port);

    //this.api = new MasterAPI(this.ctx);
    //this.sourcein = new SourceIn(this.ctx);

    this.slaveServer = new SlaveServer(
      this.streams,
      {
        password: config.slaveAuth.password
      },
    );
    this.slaveServer.listen(this.httpServer);

    const rewindGateway = new RewindGateway(
      this.streams,
      {
        password: config.slaveAuth.password,
      }
    );
    app.use(rewindGateway.getApp());

    //this.configure(this.config);

    //if (this.config.rewind_dump && false) {
    //  this.rewind_dr = new RewindDumpRestore(this, this.config.rewind_dump);
    //}

    //this.server.use("/s", this.master.transport.app);
    //this.server.use("/api", this.master.api.app);

    this.streamsUpdater = new StreamsUpdater(this.streams);
    this.streamsUpdater.update(this.config.streams);
  }

  reconfigure(newConfig: MasterConfig) {
    this.logger.info('Received new config, check for updates');

    // TODO: validate
    this.config = newConfig;

    if (_.isEqual(this.config?.streams, newConfig.streams)) {
      this.logger.info('Streams config has changed, run update');
      this.streamsUpdater!.update(newConfig.streams);
      return;
    }

    this.logger.info('Config update done');
  }
}
