import url from 'url';
import domain from "domain";
import moment from "moment";
import _ from "lodash";
import {BaseSource} from "./base/BaseSource";
import {Format} from "../slave/types";
import {Logger} from "winston";
const Icy = require('icy');

interface Config {
  readonly url: string;
  readonly format: Format;
  readonly isFallback: boolean;
  readonly logger: Logger;
}

export class UrlSource extends BaseSource {
  constructor(private readonly config: Config) {
    super(config);

    this.url = this.opts.url;

    /*this.logger = this.opts.logger.child({
      component: `source_url[${config.key}]`
    });*/

    //this.logger.debug(`url source created for ${this.url}`);

    this.defaultHeaders = this.opts.headers || {
      "user-agent": "StreamMachine 0.1.0"
    };

    this.connected = false;
    this.framesPerSec = null;
    this.connected_at = null;
    this.chunksCount = 0;
    this._in_disconnect = false;
    // connection drop handling
    // (FIXME: bouncing not yet implemented)
    this._maxBounces = 10;
    this._bounces = 0;
    this._bounceInt = 5;
    this.StreamTitle = null;
    this.StreamUrl = null;
    this.d = domain.create();
    this.d.on("error", (err) => {
      return this.niceError(err);
    });
    this.d.run(() => {
      return this.connect();
    });
  }

  TYPE() {
    return `Proxy (${this.url})`;
  }

  niceError = (err: Error & { syscall: string }) => {
    var nice_err, ref;
    this.logger.debug(`Caught error: ${err}`, err.stack);
    nice_err = (function() {
      switch (err.syscall) {
        case "getaddrinfo":
          return "Unable to look up DNS for Icecast proxy";
        case "connect":
          return "Unable to connect to Icecast proxy. Connection Refused";
        default:
          return "Error making connection to Icecast proxy";
      }
    })();

    return (ref = this.log) != null ? ref.error(`ProxySource encountered an error: ${nice_err}`, err) : void 0;
  };

  status = () => {
    var ref;
    return {
      source: (ref = typeof this.TYPE === "function" ? this.TYPE() : void 0) != null ? ref : this.TYPE,
      connected: this.connected,
      url: this.url,
      streamKey: this.streamKey,
      uuid: this.uuid,
      isFallback: this.isFallback,
      last_ts: this.last_ts,
      connected_at: this.connected_at
    };
  };

  connect = () => {
    var url_opts;
    this.createParser();
    this.logger.debug(`connect to Icecast on ${this.url}`);
    url_opts = url.parse(this.url);
    url_opts.headers = _.clone(this.defaultHeaders);
    this.last_ts = null;
    this.chunker.resetTime(new Date());
    this.ireq = Icy.get(url_opts, (ice) => {
      this.logger.debug(`connected to Icecast at ${this.url}`);
      if (ice.statusCode === 302) {
        this.url = ice.headers.location;
      }
      this.icecast = ice;
      this.icecast.once("end", () => {
        this.logger.debug("Received Icecast END event");
        return this.reconnect();
      });
      this.icecast.once("close", () => {
        this.logger.debug("Received Icecast CLOSE event");
        return this.reconnect();
      });
      this.icecast.on("metadata", (data) => {
        var meta;
        this.logger.debug("Received Icecast METADATA event");
        if (!this._in_disconnect) {
          meta = Icy.parse(data);
          if (meta.StreamTitle) {
            this.StreamTitle = meta.StreamTitle;
          }
          if (meta.StreamUrl) {
            this.StreamUrl = meta.StreamUrl;
          }
          return this.emit("metadata", {
            StreamTitle: this.StreamTitle || "",
            StreamUrl: this.StreamUrl || ""
          });
        }
      });
      // incoming -> Parser
      this.icecast.on("data", (chunk) => {
        return this.parser.write(chunk);
      });
      // return with success
      this.connected = true;
      this.connected_at = new Date();
      this.emit("connect");
      return setTimeout(this.checkStatus, 30000);
    });
    this.ireq.once("error", (err) => {
      this.logger.debug(`Got icecast stream error ${err}, reconnecting`);
      this.niceError(err);
      return this.reconnect(true);
    });
    // outgoing -> Stream
    this.on("_chunk", this.broadcastData);
    this.logChunk = this._logChunk.bind(this);
    return this.on("_chunk", this.logChunk);
  };

  broadcastData = (chunk) => {
    this.chunksCount++;
    this.last_ts = chunk.ts;
    return this.emit("data", chunk);
  };

  _logChunk = (chunk) => {
    return this.logger.silly(`received chunk from parser (time: ${toTime(chunk.ts)}, total: ${this.chunksCount})`);
  };

  checkStatus = () => {
    if (!this.connected) {
      this.logger.debug("status check: not connected, skipping");
      return;
    }
    this.logger.silly(`status check: last chunk time is ${this.last_ts.toISOString().substr(11)}`);
    if (!this.last_ts) {
      return setTimeout(this.checkStatus, 5000);
    }
    if (moment(this.last_ts).isBefore(moment().subtract(1, "minutes"))) {
      this.logger.debug("status check: last chunk timestamp is older than 1 minute ago, reconnecting");
      return this.reconnect();
    }
    return setTimeout(this.checkStatus, 30000);
  };

  reconnect = (ignoreConnectionStatus = false) => {
    var msWaitToConnect, ref, ref1, ref2, ref3;
    if (!this.connected && !ignoreConnectionStatus) {
      return;
    }
    msWaitToConnect = 5000;
    this.logger.debug(`Reconnect to Icecast source from ${this.url} in ${msWaitToConnect}ms`);
    this.connected = false;
    // Clean proxy listeners
    this.chunksCount = 0;
    this.removeListener("_chunk", this.broadcastData);
    this.removeListener("_chunk", this.logChunk);
    // Clean icecast
    if ((ref = this.ireq) != null) {
      ref.end();
    }
    if ((ref1 = this.ireq) != null) {
      if ((ref2 = ref1.res) != null) {
        ref2.client.destroy();
      }
    }
    if ((ref3 = this.icecast) != null) {
      ref3.removeAllListeners();
    }
    this.icecast = null;
    this.ireq = null;
    this.parser = null;
    this.chunker = null;
    return setTimeout(this.connect, msWaitToConnect);
  };
}
