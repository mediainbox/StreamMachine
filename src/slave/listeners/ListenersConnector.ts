import {makeOutput} from '../output/factory';
import {Listener} from "./Listener";
import {clientFromRequest} from "./client";
import {IListener} from "./IListener";
import {SlaveEvent, slaveEvents} from "../events";
import {componentLogger} from "../../logger";
import {Seconds} from "../../types/util";
import {SlaveListenerLandedEvent} from "../events/types";
import {ListenerObserver} from "./ListenerObserver";

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

  receive = ({stream, req, res}: SlaveListenerLandedEvent) => {
    this.listenersCount++;

    const listenerId = req.tracking.unique_listener_id;
    const output = makeOutput({
      stream,
      req,
      res,
      listenerId,
    });

    const streamConfig = stream.getConfig();

    const listener: IListener = new Listener(
      listenerId,
      req.tracking.session_id,
      clientFromRequest(req),

      // TODO: validate options with stream
      {
        offset: (req.query.offset ? Number(req.query.offset) : 0) as Seconds,
        initialBurst: streamConfig.listen.initialBurstSeconds,
        pumpAndFinish: !!req.query.pumpAndFinish
      }
    )
      .setLogger(componentLogger(`stream[${stream.getId()}]:listener[#${listenerId}]`))
      .setOutput(output);

    if (streamConfig.eventsReport.listener.enabled) {
      new ListenerObserver(
        stream,
        listener,
        output,
        streamConfig.eventsReport.listener.interval,
      );
    }

    stream
      .listen(listener)
      .catch(() => {
        res.status(500).end('Server error');
        listener.disconnect();
      });
  };
}
