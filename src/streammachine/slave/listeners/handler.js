import { makeOutput } from '../outputs/factory';

const { Listener } =require('./Listener');

const { outputs } = require('../outputs/factory');
const {Events} = require('../../events');

module.exports = class ListenersHandler {
  constructor({ ctx }) {
    this.ctx = ctx;

    this.hookEvents();
  }

  hookEvents() {
    this.ctx.events.on(Events.Listener.LANDED, this.receive);
  }

  receive = ({ stream, req, res }) => {
    const output = makeOutput({
      stream,
      req,
      res
    });

    const output = new OutputHandler({
      stream: req.stream,
      req,
      res,
      ctx: this.ctx
    });

    // TODO: move to class
    const client = {
      ip: req.ip,
      path: req.url,
      ua: req.query.ua || req.get('user-agent'),
      unique_listener_id: req.tracking.unique_listener_id,
      session_id: req.tracking.session_id,
    };
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const listener = new Listener(
      client,
      output,
      {
        offset
      },
    );

    this.ctx.events.emit(Events.Listener.SESSION_START, {
      stream,
      listener,
    });

    stream.listen({
      listener,
      opts: {
        offset,
        pump: output.pump
      }
    }, (err, rewinder) => {
      if (err) {
        res.status(500).end('Server error');
        listener.disconnect(true);
        return;
      }

      output.sendFrom(rewinder);
    });
  };
}
