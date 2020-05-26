import {makeOutput} from '../output/factory';
import {Listener} from "./Listener";
import {Client} from "./Client";
import {IListener} from "./IListener";
import {SlaveEvent, slaveEvents, ListenerLandedEvent} from "../events";
import {componentLogger} from "../../logger";
import {Seconds} from "../../types/util";
import {ListenOptions} from "../types";

interface Config {
}

/**
 * Connects a listener to a stream
 */
export class ListenersConnector {
  private listenersCount = 0;

  constructor() {
    this.hookEvents();
  }

  hookEvents() {
    slaveEvents().on(SlaveEvent.LISTENER_LANDED, this.receive);
  }

  receive = ({stream, req, res}: ListenerLandedEvent) => {
    this.listenersCount++;
    const listenerId = String(this.listenersCount);

    const output = makeOutput({
      listenerId,
      stream,
      req,
      res,
    });

    const streamConfig = stream.getConfig();

    // TODO: validate options with stream
    const listenOptions: ListenOptions = {
      offset: (req.query.offset ? Number(req.query.offset) : 0) as Seconds,
      initialBurst: streamConfig.listen.initialBurst,
      pumpAndFinish: !!req.query.pumpAndFinish
    };

    const listener: IListener = new Listener(stream.getId(), listenerId)
      .setClient(Client.fromRequest(req))
      .setOutput(output)
      .setOptions(listenOptions)
      .setLogger(componentLogger(`stream[${stream.getId()}]:listener[#${listenerId}]`));

    if (streamConfig.analytics.enabled) {
      listener.emitListen(streamConfig.analytics.listenInterval);
    }

    stream
      .listen(listener)
      .catch(() => {
        res.status(500).end('Server error');
        listener.disconnect();
      });
  };
}
