
// broadcasts data from a stream to all the slaves
export class StreamDataBroadcaster extends EventEmitter {
  constructor(opts) {
    super();
    this.key = opts.key;
    this.stream = opts.stream;
    this.master = opts.master;
    this.dataFunc = (chunk) => {
      return this.master.slaveServer.broadcastAudio(this.key, chunk);
    };
    this.stream.on("data", this.dataFunc);
  }

  destroy() {
    this.stream.removeListener("data", this.dataFunc);
    this.stream = null;
    this.emit("destroy");
    return this.removeAllListeners();
  }
}
