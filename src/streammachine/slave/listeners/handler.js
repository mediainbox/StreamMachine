const { outputs } = require('../outputs');
const {Events} = require('../../events');
const Listener = require('./listener');

module.exports = class ListenersHandler {
  constructor({ ctx }) {
    this.ctx = ctx;

    this.hookEvents();
  }

  hookEvents() {
    this.ctx.events.on(Events.Listener.LANDED, this.receive);
  }

  receive = ({ stream, req, res }) => {
    const OutputHandler = outputs.find(output => {
      return output.canHandleRequest(req);
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

    const listener = new Listener({
      client,
      output,
      opts: {
        offset
      },
    });

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
    }, (err, source) => {
      if (err) {
        res.status(500).end(err);
        listener.disconnect(true);
        return;
      }

      output.send(source);
    });
  };
}
