import {Logger} from "winston";
import {componentLogger} from "../../logger";
import {SlaveConnections} from "./SlaveConnections";
import SocketIO from "socket.io";
import * as http from "http";
import {SlaveConnection} from "./SlaveConnection";
import {StreamsCollection} from "../streams/StreamsCollection";
import {MasterWsSocket, SlaveWsMessage} from "../../messages";
import {MasterEvent, masterEvents} from "../events";
import {StreamChunk} from "../../types";

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
    private readonly streams: StreamsCollection,
    private readonly config: Config,
  ) {
    this.logger = componentLogger("slave_server");

    this.connections = new SlaveConnections();

    //this.master.on(Events.Master.CONFIG_UPDATE, cUpdate); -> update slaves
    // CONFIG_UPDATE_DEBOUNCE

    this.hookEvents();
  }

  hookEvents() {
    masterEvents().on(MasterEvent.CHUNK, this.broadcastChunk);
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

      const sentPassword = socket.request._query.password;
      const slaveId = socket.request._query.slaveId;

      this.logger.debug(`Got connection from slave #${slaveId} at socket ${socket.id}`);

      if (this.config.password !== sentPassword) {
        this.logger.error(`Slave auth is invalid (password ${sentPassword} is incorrect)`);
        next(new Error("Invalid slave password"));
        return;
      } else if (!slaveId) {
        this.logger.error(`Slave did not provide id`);
        next(new Error("Missing slave id"));
        return;
      } else if (this.connections.get(slaveId)) {
        const error = new Error(`Slave with id "${slaveId}" already connected`);
        this.logger.error(error);
        next(error);
        return;
      }

      return next();
    });

    // look for slave connections
    this.wsServer.on("connect", (socket: MasterWsSocket) => {
      const slaveId = socket.request._query.slaveId;

      // a slave may make multiple connections to test transports. we're
      // only interested in the one that gives us the OK
      socket.once(SlaveWsMessage.CONNECTION_VALIDATE, (cb) => {
        this.logger.info(`Validated slave #${slaveId} connection`);

        // ping back to let the slave know we're here
        cb("OK");

        this.handleNewSlave(slaveId, socket);
      });
    });
  }

  handleNewSlave(slaveId: string, socket: MasterWsSocket) {
    const connection = new SlaveConnection(slaveId, socket);
    this.connections.add(slaveId, connection);

    connection.sendStreams(this.streams.toArray());

    connection.on('disconnect', () => {
      this.connections.remove(slaveId);
    });
  }

  broadcastChunk = (chunk: StreamChunk) => {
    this.connections.map(connection => {
      connection.sendChunk(chunk);
    });
  };

  pollForSync(): void {
  }
}
