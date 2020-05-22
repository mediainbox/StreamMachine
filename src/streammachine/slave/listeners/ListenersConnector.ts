import { makeOutput } from '../output/factory';
import {ListenerLandedEvent, SlaveCtx} from "../types";
import {Listener} from "./Listener";
import {Client} from "./Client";
import {IListener} from "./IListener";
const {Events} = require('../../events');

/**
 * Connects a listener to a stream
 */
export class ListenersConnector {
  private listenersCount = 0;

  constructor(private readonly ctx: SlaveCtx) {
    this.hookEvents();
  }

  hookEvents() {
    this.ctx.events.on(Events.Listener.LANDED, this.receive);
  }

  receive = ({ stream, req, res }: ListenerLandedEvent) => {
    this.listenersCount++;
    const listenerId = String(this.listenersCount);

    const output = makeOutput({
      listenerId,
      stream,
      req,
      res,
      logger: this.ctx.logger,
    });

    const listener: IListener = new Listener(stream.getId(), listenerId)
      .setClient(Client.fromRequest(req))
      .setOutput(output)
      .setOptions({
        offset: req.query.offset ? Number(req.query.offset) : 0,
        pump: output.shouldPump()
      })
      .setListenInterval(stream.getConfig().listenEventInterval)
      .setLogger(
        this.ctx.logger.child({
          component: `stream[${stream.getId()}]:listener[#${listenerId}]`,
        })
      )
      .setEvents(this.ctx.events);

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
