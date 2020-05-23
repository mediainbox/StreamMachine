import express from "express";

class StreamTransport {
  constructor(master) {
    this.master = master;
    this.app = express();
    // -- Param Handlers -- #
    this.app.param("stream", (req, res, next, key) => {
      var s;
      // make sure it's a valid stream key
      if ((key != null) && (s = this.master.streams[key])) {
        req.stream = s;
        return next();
      } else {
        return res.status(404).end("Invalid stream.\n");
      }
    });
    // -- Validate slave id -- #
    this.app.use((req, res, next) => {
      var sock_id;
      sock_id = req.get('stream-slave-id');
      if (sock_id && this.master.slaveServer.slaveConnections[sock_id]) {
        //req.slave_socket = @master.slaveServer[ sock_id ]
        return next();
      } else {
        this.master.logger.debug("Rejecting StreamTransport request with missing or invalid socket ID.", {
          sock_id: sock_id
        });
        return res.status(401).end("Missing or invalid socket ID.\n");
      }
    });
    // -- Routes -- #
    this.app.get("/:stream/rewind", (req, res) => {
      this.master.logger.debug(`Rewind Buffer request from slave on ${req.stream.key}.`);
      res.status(200).write('');
      return req.stream.getRewind((err, writer) => {
        writer.pipe(new Throttle(100 * 1024 * 1024)).pipe(res);
        return res.on("end", () => {
          return this.master.logger.debug("Rewind dumpBuffer finished.");
        });
      });
    });
  }

};
