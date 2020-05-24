import url from 'url';
import moment from "moment";
import {Logger} from "winston";
import {BaseSource, SourceConfig} from "../base/BaseSource";
import {toTime} from "../../../helpers/datetime";
import {Chunk, Format, StreamMetadata} from "../../../types";
import {ClientRequest, IncomingMessage} from "http";

const Icy = require('icy');

interface Config extends SourceConfig {
  readonly url: string;
  readonly format: Format;
  readonly isFallback: boolean;
  readonly logger: Logger;
}

const CHECK_INTERVAL = 30000;
const RECONNECT_WAIT = 5000;

export class UrlSource extends BaseSource {
  private icyRequest?: ClientRequest;
  private icyResponse?: IncomingMessage;
  private lastChunkTs: number | null;
  private redirectedUrl: string;

  constructor(
    readonly config: Config,
    readonly logger: Logger
  ) {
    super(config, logger);

    this.logger.debug(`create url for ${config.url}`);
  }

  getType() {
    return `Proxy (${this.config.url})`;
  }

  niceError = (err: Error & { syscall?: string }) => {
    this.logger.debug(`Caught error: ${err}`, err.stack);
    const nice_err = (function () {
      switch (err.syscall) {
        case "getaddrinfo":
          return "Unable to look up DNS for Icecast proxy";
        case "connect":
          return "Unable to connect to Icecast proxy. Connection Refused";
        default:
          return "Error making connection to Icecast proxy";
      }
    })();

    this.logger.error(`ProxySource encountered an error: ${nice_err}`, err);
  };

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
    this.logger.debug(`connect to Icecast at ${this.config.url}`);

    this.lastChunkTs = null;
    this.chunker.resetTime(Date.now());

    this.icyRequest = Icy.get({
      ...url.parse(this.redirectedUrl || this.config.url),
      headers: {
        "user-agent": "StreamMachine"
      }
    }, (res: IncomingMessage) => {
      this.icyResponse = res;

      this.logger.debug(`connected successfully`);
      if (res.statusCode === 302) {
        this.redirectedUrl = res.headers.location!;
      }

      this.icyResponse.once("end", () => {
        this.logger.debug("Received Icecast END event");
        this.reconnect();
      });

      this.icyResponse.once("close", () => {
        this.logger.debug("Received Icecast CLOSE event");
        this.reconnect();
      });

      this.icyResponse.on("metadata", (data) => {
        this.logger.debug("Received Icecast METADATA event");
        const meta = Icy.parse(data);

        this.emit("metadata", {
          title: meta.StreamTitle || "",
          url: meta.StreamUrl || ""
        } as StreamMetadata);
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

    this.icyRequest!.once("error", (err) => {
      this.logger.debug(`Got icecast stream error ${err}, reconnecting`);
      this.niceError(err);
      this.reconnect(true);
    });

    // outgoing -> Stream
    this.on("_chunk", this.broadcastData);

    this.on("_chunk", this.logChunk);
  };

  broadcastData = (chunk: Chunk) => {
    this.lastChunkTs = chunk.ts;
    return this.emit("data", chunk);
  };

  logChunk = (chunk: Chunk) => {
    return this.logger.silly(`received chunk from parser (time: ${toTime(chunk.ts)})`);
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


    this.removeListener("_chunk", this.broadcastData);
    this.removeListener("_chunk", this.logChunk);


    // clean icecast
    this.icyRequest?.end();
    (this.icyRequest as any)?.res?.client.destroy(); // FIXME
    this.icyResponse?.removeAllListeners();

    setTimeout(this.connect, RECONNECT_WAIT);
  };
}
