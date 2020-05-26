import './types/ambient';
import {EventEmitter} from 'events';
import {MasterConfig, MasterStreamConfig} from "./types";
import {StreamsCollection} from "./streams/StreamsCollection";
import {Stream} from "./stream/Stream";
import {Logger} from "winston";
import {componentLogger, createLogger} from "../logger";
import {SlaveServer} from "./slave_io/SlaveServer";
import * as http from "http";
import express from "express";
import {RewindGateway} from "./slave_io/RewindGateway";

/**
 * Master handles configuration, slaves, incoming sources,
 * logging and the admin interface
 */
export class Master extends EventEmitter {
  private readonly streams: StreamsCollection;
  private readonly logger: Logger;
  private readonly slaveServer: SlaveServer;
  private readonly httpServer: http.Server;

  constructor(private readonly config: MasterConfig) {
    super();

    createLogger('master', config.log);
    this.logger = componentLogger("master");

    this.logger.info("Initialize master");

    const app = express();
    this.httpServer = app.listen(config.server.port);

    this.streams = new StreamsCollection();

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

    this.configureStreams(config.streams);
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

  // configre can be called on a new core, or it can be called to
  // reconfigure an existing core.  we need to support either one.
  configureStreams(streamsConfig: readonly MasterStreamConfig[]) {

    streamsConfig.forEach(config => {

      const stream = new Stream(
        config.id,
        config, // TODO: inherit config from master
      );

      //stream.configure(config);

      //this.streams[key].configure(opts);
      this.streams.add(config.id, stream);

      //this._attachIOProxy(stream);
      //return this.emit(Events.Master.STREAMS_UPDATE, this.streams);
      //this.emit(Events.Master.NEW_STREAM, stream);
    });

    /*removeStream() {
      delete this.streams[stream.key];
      stream.destroy();
    }*/
  }
}
