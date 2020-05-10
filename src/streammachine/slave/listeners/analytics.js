

recordListen(opts) {
  var lmeta, nothing;
  if (opts.bytes) {
    // temporary conversion support...
    opts.kbytes = Math.floor(opts.bytes / 1024);
  }
  if (_.isNumber(opts.kbytes)) {
    this.stats.kbytesSent += opts.kbytes;
  }

  const listener = this.listeners.get(opts.id);
  if (listener) {
    this.ctx.events.emit(Events.Listener.LISTEN, {
      stream: this.key,
      type: "listen",
      client: listener.obj.client,
      time: new Date(),
      kbytes: opts.kbytes,
      duration: opts.seconds,
      offsetSeconds: opts.offsetSeconds,
      contentTime: opts.contentTime
    });
  }
}
