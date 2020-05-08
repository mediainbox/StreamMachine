var RPCProxy;

module.exports = RPCProxy = class RPCProxy extends require("events").EventEmitter {
  constructor(a, b) {
    super();
    this.a = a;
    this.b = b;
    this.messages = [];
    this._aFunc = (msg, handle) => {
      this.messages.push({
        sender: "a",
        msg: msg,
        handle: handle != null
      });
      //console.log "a->b: #{msg.key}\t#{handle?}"
      this.b.send(msg, handle);
      if (msg.err) {
        return this.emit("error", msg);
      }
    };
    this._bFunc = (msg, handle) => {
      this.messages.push({
        sender: "b",
        msg: msg,
        handle: handle != null
      });
      //console.log "b->a: #{msg.id || msg.reply_id}\t#{msg.key}\t#{handle?}"
      this.a.send(msg, handle);
      if (msg.err) {
        return this.emit("error", msg);
      }
    };
    this.a.on("message", this._aFunc);
    this.b.on("message", this._bFunc);
  }

  disconnect() {
    this.a.removeListener("message", this._aFunc);
    return this.b.removeListener("message", this._bFunc);
  }

};
