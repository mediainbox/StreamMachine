import {SlaveStatus} from "../../slave/types";
import {componentLogger} from "../../logger";
import {Logger} from "winston";
import {MasterWsMessage, MasterWsSocket} from "../../messages";
import {TypedEmitterClass} from "../../helpers/events";
import {MasterStream} from "../stream/Stream";
import {getStreamsDataForSlaves} from "./helpers";
import {StreamChunk} from "../../types/stream";

interface Events {
  disconnect: () => void;
}

export class SlaveConnection extends TypedEmitterClass<Events>() {
  private readonly logger: Logger;
  private readonly connectedAt: Date;

  constructor(
    private readonly slaveId: string,
    private readonly socket: MasterWsSocket
  ) {
    super();
    this.connectedAt = new Date();

    this.logger = componentLogger(`slave_connection[#${slaveId}]`);

    this.hookEvents();
  }

  hookEvents() {
    // attach disconnect handler
    this.socket.on("disconnect", () => {
      this.handleDisconnect();
    });
  }

  sendChunk(chunk: StreamChunk) {
    this.socket.emit(MasterWsMessage.CHUNK, chunk);
  }

  sendStreams(streams: readonly MasterStream[]) {
    this.socket.emit(MasterWsMessage.STREAMS, getStreamsDataForSlaves(streams));
  }

  getStatus(): Promise<SlaveStatus> {
    return new Promise((resolve, reject) => {
      /*this.ws.emit(Events.Link.SLAVE_STATUS, (err, status) => {
        if (err) {
          reject(err);
          return;
        }

        this.last_status = status;
        resolve(status);
      });*/
    })
  }

  handleDisconnect() {
    const mins = Math.round((Number(new Date()) - Number(this.connectedAt)) / 60000);
    this.logger.info(`Slave disconnected (connected for ${mins} minutes)`);
    this.emit("disconnect");
  }
}
