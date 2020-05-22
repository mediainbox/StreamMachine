import {MasterConnection} from "../master_io/MasterConnection";
import {Events, EventsHub} from "../../events";
import {IListener} from "../listeners/IListener";

export class AnalyticsReporter {
  constructor(
    private readonly masterConnection: MasterConnection,
    private readonly events: EventsHub
  ) {
    this.hookEvents();
  }

  // serialize events to go through ws
  private hookEvents() {
    this.events.on(Events.Listener.SESSION_START, (listener: IListener) => {
      this.masterConnection.send(Events.Listener.SESSION_START, {
        stream: listener.streamId,
        listener: {
          connectedAt: listener.connectedAt,
          client: listener.client.toJson(),
        }
      });
    });

    this.events.on(Events.Listener.LISTEN, data => {
      this.masterConnection.send(Events.Listener.LISTEN, data);
    });
  }
}
