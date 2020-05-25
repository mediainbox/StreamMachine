import url from 'url';
import moment from "moment";
import {BaseSource} from "../base/BaseSource";
import {toTime} from "../../../helpers/datetime";
import {Chunk, StreamMetadata} from "../../../types";
import {ClientRequest, IncomingMessage} from "http";
import {SourceConfig} from "../base/ISource";

const Icy = require('icy');

const CHECK_INTERVAL = 30000;
const RECONNECT_WAIT = 5000;

interface Config extends SourceConfig {
  readonly url: string;
}

export class IcecastUrlSource extends BaseSource {
  private icyRequest?: ClientRequest;
  private icyResponse?: IncomingMessage;
  private lastChunkTs: number | null = null;
  private redirectedUrl?: string;

  constructor(
    readonly config: Config,
  ) {
    super(config);

    this.logger.info(`Create source from ${config.url}`);
  }

  getStatus() {
    return {
      id: this.id,
      type: this.getType(),
      connected: this.connected,
      connectedAt: this.connectedAt,
      config: this.config,
      vitals: this.vitals,
      lastChunkTs: this.lastChunkTs,
    };
  }

  connect = () => {
    this.logger.info(`Connect to Icecast at ${this.config.url}`);

    this.lastChunkTs = null;
    this.chunker.resetTime(Date.now());

    const parsedUrl = url.parse(this.redirectedUrl || this.config.url);

    this.icyRequest = Icy.get({
      ...parsedUrl,
      headers: {
        "user-agent": "StreamMachine"
      }
    }, (res: IncomingMessage) => {
      this.icyResponse = res;

      this.logger.debug(`Connected successfully`);

      if (res.statusCode === 302) {
        this.redirectedUrl = res.headers.location!;
      }

      this.icyResponse.once("end", () => {
        this.logger.warn("Got Icecast end event");
        this.reconnect();
      });

      this.icyResponse.once("close", () => {
        this.logger.debug("Got Icecast close event");
        this.reconnect();
      });

      this.icyResponse.on("metadata", (data) => {
        this.logger.debug("Got Icecast metadata event");
        const meta = Icy.parse(data);

        this.emit("metadata", {
          title: meta.StreamTitle || "",
          url: meta.StreamUrl || ""
        });
      });

      // incoming -> Parser
      this.icyResponse.on("data", (chunk) => {
        this.parser.write(chunk);
      });

      this.connected = true;
      this.connectedAt = new Date();
      this.emit("connect");

      setTimeout(this.checkStatus, CHECK_INTERVAL);
    });

    this.icyRequest!.once("error", (error) => {
      this.logger.error(`Got icecast stream error ${error}, reconnecting`, {
        error
      });
      this.reconnect(true);
    });

    // outgoing -> Stream
    this.on("chunk", this.logChunk);
  };

  logChunk = (chunk: Chunk) => {
    this.logger.silly(`received chunk from parser (time: ${toTime(chunk.ts)})`)
    this.lastChunkTs = chunk.ts;
  };

  checkStatus = () => {
    if (!this.connected) {
      this.logger.debug("status check: not connected, skip status check");
      return;
    }

    this.logger.silly(`status check: last chunk time is ${this.lastChunkTs ? toTime(this.lastChunkTs) : 'NULL'}`);

    if (!this.lastChunkTs) {
      setTimeout(this.checkStatus, 5000);
      return;
    }

    if (moment(this.lastChunkTs).isBefore(moment().subtract(1, "minutes"))) {
      this.logger.debug("status check: last chunk timestamp is older than 1 minute ago, reconnecting");
      this.reconnect();
      return;
    }

    setTimeout(this.checkStatus, 30000);
  };

  reconnect = (ignoreConnectionStatus = false) => {
    if (!this.connected && !ignoreConnectionStatus) {
      return;
    }

    this.logger.debug(`Reconnect to Icecast source from ${this.config.url} in ${RECONNECT_WAIT}ms`);
    this.connected = false;


    this.removeListener("chunk", this.logChunk);


    // clean icecast
    this.icyRequest?.end();
    (this.icyRequest as any)?.res?.client.destroy(); // FIXME
    this.icyResponse?.removeAllListeners();

    setTimeout(this.connect, RECONNECT_WAIT);
  };
}
