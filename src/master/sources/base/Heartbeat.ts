

export function sourceHeartbeat() {


  /*
   if (source_opts.useHeartbeat) {
    // -- Alert if data stops flowing -- #
    // creates a sort of dead mans switch that we use to kill the connection
    // if it stops sending data
    this._pingData = new Debounce(this.opts.heartbeatTimeout || 30 * 1000, (last_ts) => {
      var ref1;
      if (!this.isDisconnected) {
        // data has stopped flowing. kill the connection.
        if ((ref1 = this.log) != null) {
          ref1.info("Source data stopped flowing.  Killing connection.");
        }
        this.emit("_source_dead", last_ts, Number(new Date()));
        return this.disconnect();
      }
    });
  }



    // pass frames to chunker
    this.parser.on("frame", (frame: Buffer, header: FrameHeader) => {
      //this._pingData.ping(); // heartbeat?

      return this.chunker.write({
        frame: frame,
        header: header
      });
    });



  disconnect() {
    this.logger.info('source disconnected');
    this.isDisconnected = true;

    this.chunker?.removeAllListeners();
    this.parser?.removeAllListeners();

    //this._pingData.kill();
  }

   */
}
