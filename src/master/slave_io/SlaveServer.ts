import express from "express";
import {TypedEmitter} from "../../helpers/events";
import {Logger} from "winston";
import {componentLogger} from "../../logger";
import {SlaveConnections} from "./SlaveConnections";
import SocketIO from "socket.io";
import * as http from "http";
import {SlaveConnection} from "./SlaveConnection";
import {StreamChunk, StreamRequest} from "../types";
import {StreamsCollection} from "../streams/StreamsCollection";
import Throttle from "throttle";
import {MasterWsSocket, SlaveWsMessage} from "../../messages";

// Socket.IO server that listens for Slave connections
// Will create a SlaveConnection for each connected Slave
// See also slave/MasterConnection for the counterpart on the slave
// Emits:
// - Events.Link.CONFIG
// - Events.Link.AUDIO

const CONFIG_UPDATE_DEBOUNCE = 200;

interface Config {
  readonly password: string;
}

export class SlaveServer {
  private readonly logger: Logger;
  private readonly connections: SlaveConnections;
  private wsServer?: SocketIO.Server;

  constructor(
    private readonly config: Config,
    private readonly streams: StreamsCollection,
  ) {
    this.logger = componentLogger("slave_server");

    this.connections = new SlaveConnections();

    //this.master.on(Events.Master.CONFIG_UPDATE, cUpdate); -> update slaves
    // CONFIG_UPDATE_DEBOUNCE
  }

  listen(server: http.Server) {
    // fire up a socket listener on our slave port
    this.wsServer = SocketIO.listen(server, {
      pingInterval: 30000,
      pingTimeout: 30000,
    });

    this.logger.info("Master now listening for slave connections");

    // add our authentication
    this.wsServer.use((socket, next) => {
      this.logger.debug("Check auth for slave connection");

      const sentPassword = socket.request._query.password;
      const slaveId = socket.request._query.slaveId;

      if (this.config.password !== sentPassword) {
        this.logger.error(`Slave auth is invalid (password ${sentPassword} is incorrect)`);
        next(new Error("Invalid slave password"));
        return;
      } else if (!slaveId) {
        this.logger.error(`Slave did not provide id`);
        next(new Error("Missing slave id"));
        return;
      }

      this.logger.debug("Slave auth is valid");
      return next();
    });

    // look for slave connections
    this.wsServer.on("connect", (socket: MasterWsSocket) => {
      const slaveId = socket.request._query.slaveId;
      this.logger.debug("Master got connection");

      // a slave may make multiple connections to test transports. we're
      // only interested in the one that gives us the OK
      socket.once(SlaveWsMessage.CONNECTION_VALIDATE, (cb) => {
        this.logger.debug(`Validated incoming slave connection at socket ${socket.id}`);

        // ping back to let the slave know we're here
        cb("OK");

        this.logger.debug(`slave connection is ${socket.id}`);
        //socket.emit(Events.Link.CONFIG, this._config);

        this.connections.add(slaveId, new SlaveConnection(slaveId, socket));
        /*this.slaveConnections[socket.id].on(Events.Link.DISCONNECT, () => {
          return this.emit("disconnect", socket.id);
        });*/
      });
    });
  }

  broadcastChunk(chunk: StreamChunk) {
    this.connections.map(connection => {
      connection.sendChunk(chunk);
    })
  }

  pollForSync(): void {
  }

  getRewindApi() {
    const app = express();

    app.param("stream", (req, res, next, key) => {
      const stream = this.streams.get(key);

      if (!stream) {
        res.status(404).send("Invalid stream");
        return;
      }

      req.mStream = stream;
    });

    // validate password
    app.use((req, res, next) => {
      const sentPassword = req.query.password;

      if (this.config.password !== sentPassword) {
        this.logger.warn(`Slave auth is invalid (password ${sentPassword} is incorrect)`);
        res.status(403).send("Invalid password");
        return;
      }

      this.logger.debug("Slave auth is valid");
      next();
    });

    app.get("/:stream/rewind", (req: StreamRequest, res) => {
      this.logger.debug(`RewindBuffer request from slave on ${req.stream!}.`);
      res.status(200).write('');

      req.stream!
        .getRewind()
        .then(rewindStream => {
          rewindStream.pipe(new Throttle(100 * 1024 * 1024)).pipe(res);

          res.on("end", () => {
            this.logger.debug("RewindBuffer sent successfully");
          });
        });
    });

    return app;
  }
}
