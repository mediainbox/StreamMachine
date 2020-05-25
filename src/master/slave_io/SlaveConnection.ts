import {SlaveStatus} from "../../slave/types";
import {componentLogger} from "../../logger";
import {Logger} from "winston";
import {StreamChunk} from "../types";
import {MasterWsSocket} from "../../messages";

export class SlaveConnection {
  private readonly logger: Logger;
  private readonly connectedAt: Date;

  constructor(
    private readonly slaveId: string,
    private readonly socket: MasterWsSocket
  ) {
    this.connectedAt = new Date();

    this.logger = componentLogger(`slave_connection[${slaveId}]`);

    this.hookEvents();
  }

  hookEvents() {
    // attach disconnect handler
    this.socket.on("disconnect", () => {
      this.handleDisconnect();
    });
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
    this.logger.debug(`slave ${this.slaveId} disconnected (connected for ${mins} minutes)`);
    //this.emit("disconnect");
  }

  sendChunk(chunk: StreamChunk) {
    this.socket.emit('chunk', chunk);
  }
}
