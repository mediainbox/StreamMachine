import {MasterConnection} from "../master_io/MasterConnection";
import {IListener} from "../listeners/IListener";
import {ListenEventData, SlaveEvent, slaveEvents} from "../events";

export class AnalyticsReporter {
  constructor(
    private readonly masterConnection: MasterConnection,
  ) {
    this.hookEvents();
  }

  // serialize events to go through ws
  private hookEvents() {
    slaveEvents().on(SlaveEvent.LISTENER_SESSION_START, (listener: IListener) => {
      /*this.masterConnection.send(Events.Listener.SESSION_START, {
        stream: listener.streamId,
        ts: Date.now(),
        listener: {
          connectedAt: listener.connectedAt,
          client: listener.client.toJson(),
        }
      });*/
    });

    slaveEvents().on(SlaveEvent.LISTENER_LISTEN, (data: ListenEventData) => {
      /*this.masterConnection.send(Events.Listener.LISTEN, {
        stream: data.streamId,
        ts: data.ts,
        listener: {
          connectedAt: data.listener.connectedAt,
          sentBytes: data.sentBytes,
          sentSeconds: data.sentSeconds,
          client: data.listener.client.toJson(),
        }
      });*/
    });
  }
}
