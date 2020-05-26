import {makeOutput} from '../output/factory';
import {Listener} from "./Listener";
import {Client} from "./Client";
import {IListener} from "./IListener";
import {SlaveEvent, slaveEvents, ListenerLandedEvent} from "../events";
import {componentLogger} from "../../logger";
import {Seconds} from "../../types/util";

interface Config {
  readonly listenInterval: Seconds;
}

/**
 * Connects a listener to a stream
 */
export class ListenersConnector {
  private listenersCount = 0;

  constructor(private readonly config: Config) {
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

    const listener: IListener = new Listener(stream.getId(), listenerId)
      .setClient(Client.fromRequest(req))
      .setOutput(output)
      .setOptions({
        offset: req.query.offset ? Number(req.query.offset) : 0,
        pump: output.shouldPump()
      })
      .setListenInterval(this.config.listenInterval)
      .setLogger(componentLogger(`stream[${stream.getId()}]:listener[#${listenerId}]`));

    stream
      .listen(listener)
      .then(source => {
        listener.send(source);
      })
      .catch(() => {
        res.status(500).end('Server error');
        listener.disconnect();
      });
  };
}
