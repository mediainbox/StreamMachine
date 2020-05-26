import express from "express";
import Throttle from "throttle";
import {StreamsCollection} from "../streams/StreamsCollection";
import {componentLogger} from "../../logger";
import {Logger} from "winston";

interface Config {
  readonly password: string;
}

export class RewindGateway {
  private readonly app: express.Application;
  private readonly logger: Logger;

  constructor(
    private readonly streams: StreamsCollection,
    private readonly config: Config,
  ) {
    this.logger = componentLogger('rewind_gateway');
    const app = this.app = express();

    // validate password
    app.use((req, res, next) => {
      const { password, slaveId } = req.query;

      if (!slaveId) {
        this.logger.warn(`Slave id is missing`);
        res.status(403).send("Missing slave id");
        return;
      }

      if (this.config.password !== password) {
        this.logger.warn(`Slave auth is invalid (password ${password} is incorrect)`);
        res.status(403).send("Invalid password");
        return;
      }

      next();
    });

    app.param("stream", (req, res, next, key) => {
      const stream = this.streams.get(key);

      if (!stream) {
        res.status(404).send("Invalid stream");
        return;
      }

      req.mStream = stream;
      next();
    });

    app.get("/slave/:stream/rewind", (req, res) => {
      this.logger.info(`RewindBuffer request from slave #${req.query.slaveId} for ${req.mStream.getId()}`);
      res.status(200).write('');

      req.mStream
        .dumpRewindBuffer()
        .then(rewindStream => {
          rewindStream.pipe(new Throttle(100 * 1024 * 1024)).pipe(res);

          res.on("end", () => {
            this.logger.info("RewindBuffer sent successfully");
          });
        });
    });
  }

  getApp() {
    return this.app;
  }
}
