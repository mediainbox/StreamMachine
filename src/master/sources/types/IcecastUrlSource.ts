import url from 'url';
import moment from "moment";
import {toTime} from "../../../helpers/datetime";
import {Chunk, SourceState} from "../../../types";
import {ClientRequest, IncomingMessage} from "http";
import {Logger} from "winston";
import {Mutable} from "../../../helpers/types";
import {passthrough} from "../../../helpers/events";
import {SourceChunker} from "../base/SourceChunker";
import {IcecastUrlConfig} from 'src/master/types/config';
import {BaseSource} from "../base/BaseSource";

const Icy = require('icy');

const CHECK_INTERVAL = 30000;
const RECONNECT_WAIT = 5000;

export class IcecastUrlSource extends BaseSource<IcecastUrlConfig> {
  private icyRequest?: ClientRequest;
  private icyResponse?: IncomingMessage;

  private redirectedUrl?: string;

  private checkStatusTimeout?: NodeJS.Timeout;
  private reconnectTimeout?: NodeJS.Timeout;

  constructor(
    readonly config: IcecastUrlConfig,
    readonly sourceChunker: SourceChunker,
    readonly logger: Logger,
  ) {
    super(config, logger);

    passthrough(['chunk', 'vitals'], this.sourceChunker, this);
  }

  configure(config: IcecastUrlConfig) {
    (this.config.priority as Mutable<number>) = config.priority;
  }

  getStatus() {
    return {} as any;
  }

  connect = () => {
    this.logger.info(`Connect to Icecast at ${this.config.url}`);
    this.sourceChunker.reset();


    const parsedUrl = url.parse(this.redirectedUrl || this.config.url);

    this.icyRequest = Icy.get({
      ...parsedUrl,
      headers: {
        "user-agent": "StreamMachine"
      }
    }, (res: IncomingMessage) => {
      this.icyResponse = res;

      this.logger.info(`Connected successfully`);

      if (res.statusCode === 302) {
        this.redirectedUrl = res.headers.location!;
      }

      this.icyResponse.once("end", () => {
        this.logger.warn("Got Icecast end event");
        this.disconnect();
        this.reconnect();
      });

      this.icyResponse.once("close", () => {
        this.logger.debug("Got Icecast close event");
        this.disconnect();
        this.reconnect();
      });

      this.icyResponse.on("metadata", (data) => {
        const meta = Icy.parse(data);
        //this.logger.debug("Got Icecast metadata event", { meta });

        this.emit("metadata", {
          title: meta.StreamTitle || "",
          url: meta.StreamUrl || ""
        });
      });

      // incoming -> Parser
      this.icyResponse.pipe(this.sourceChunker);

      this.emit("connect");
      this.checkStatusTimeout = setTimeout(this.checkStatus, CHECK_INTERVAL);
    });

    this.icyRequest!.once("error", (error) => {
      this.logger.error(`Got icecast stream error ${error}, reconnecting`, {
        error
      });

      this.emit('connect_error', error);
      this.reset();
      this.reconnect();
    });
  };

  checkStatus = () => {
    if (!this.isConnected()) {
      this.logger.debug("Status check: not connected, skip status check");
      return;
    }

    this.logger.silly(`Status check: last chunk is ${this.lastChunkTs ? toTime(this.lastChunkTs) : 'NULL'}`);

    if (!this.lastChunkTs) {
      this.checkStatusTimeout = setTimeout(this.checkStatus, 5000);
      return;
    }

    if (moment(this.lastChunkTs).isBefore(moment().subtract(1, "minutes"))) {
      this.logger.debug("Status check: last chunk is older than 1 min ago, reconnecting");
      this.reconnect();
      return;
    }

    this.checkStatusTimeout = setTimeout(this.checkStatus, 30000);
  };

  reconnect = () => {
    if (this.isConnected()) {
      return;
    }

    this.logger.debug(`Reconnect to Icecast source from ${this.config.url} in ${RECONNECT_WAIT}ms`);
    this.reconnectTimeout = setTimeout(this.connect, RECONNECT_WAIT);
  };

  reset() {
    this.checkStatusTimeout && clearInterval(this.checkStatusTimeout);
    this.reconnectTimeout && clearInterval(this.reconnectTimeout);

    this.icyRequest?.destroy();
    this.icyResponse?.destroy();

    this.icyRequest?.removeAllListeners();
    this.icyResponse?.removeAllListeners();
  }

  disconnect(): void {
    if (!this.isConnected()) {
      return;
    }

    this.emit('disconnect');
    this.reset();
  }

  destroy(): void {
    this.sourceChunker.destroy();
  }
}
