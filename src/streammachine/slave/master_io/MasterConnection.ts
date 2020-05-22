import {InputConfig, SlaveCtx, SlaveStatus, StreamVitals} from "../types";
import {EventEmitter} from "events";
import {Logger} from "winston";
import {WsAudioMessage} from "../../../types";
import {toTime} from "../../../helpers/datetime";
import axios from 'axios';
import {Readable} from "stream";
import {promiseTimeout} from "../../../helpers/promises";
import socketIO from "socket.io-client";
import {Events} from "../../events";

const REWIND_REQUEST_TIMEOUT = 15 * 1000;
const ALIVE_INTERVAL = 5000;

/**
 * Interface communicaions to Master
 */
export class MasterConnection {
  private readonly logger: Logger;
  private readonly config: {
    readonly master: string[];
    readonly timeout?: number;
  };

  private ws: SocketIOClient.Socket;
  private id: string;
  private connected = false;
  private attempts = 0;
  private masterUrlIndex = 0;
  private aliveInterval: NodeJS.Timeout;

  constructor(private readonly ctx: SlaveCtx) {
    this.logger = this.ctx.logger.child({
      component: 'master_connection'
    });
    this.config = this.ctx.config.slave;

    this.connect();
  }

  send(event: string, ...args: any[]) {
    this.ws.emit(event, ...args);
  }

  // TODO: vitals to configuration
  getStreamVitals(key: string, cb: (err: Error | null, vitals: StreamVitals) => void) {
    this.ws.emit(Events.Link.STREAM_VITALS, key, cb);
  }

  connect() {
    const masterWsUrl = this.config.master[this.masterUrlIndex];

    this.logger.info(`connect to master at ${masterWsUrl}`);

    this.ws = socketIO.connect(masterWsUrl, {
      reconnection: true,
      reconnectionAttempts: 3,
      timeout: this.config.timeout,
    });

    const onConnectError = (err: Error & { description: string; }) => {
      this.logger.warn(`connect attempt to master[${this.masterUrlIndex}] failed: ${err.message} (${err.description})`)
      this.attempts++;
    };

    this.ws.on("connect_error", onConnectError);

    this.ws.on("connect", () => {
      this.logger.info(`connection to master[${this.masterUrlIndex}] started`);

      // TODO: verify this
      // make sure our connection is valid with a ping
      const pingTimeout = setTimeout(() => {
        this.logger.warn("failed to get master OK ping response");
        this.tryFallbackConnection();
      }, 1000);

      return this.ws.emit(Events.Link.CONNECTION_VALIDATE, (res: string) => {
        clearTimeout(pingTimeout);

        if (res !== 'OK') {
          this.logger.warn(`invalid master OK ping response (got ${res})`);
          this.tryFallbackConnection();
          return;
        }

        // custom ping packet to keep connection alive beyond
        // socket.io ping config which relies on sent pkgs
        this.aliveInterval = setInterval(() => {
          this.ws.emit('alive');
        }, ALIVE_INTERVAL);

        this.ws.off('connect_error', onConnectError);
        this.logger.info("connection to master validated, slave is connected");
        this.id = this.ws.id;
        this.connected = true;

        this.ctx.events.emit(Events.Slave.CONNECTED);
      });
    });

    this.ws.on("disconnect", () => {
      this.connected = false;
      this.logger.info("disconnected from master");

      this.masterUrlIndex = -1; // FIXME
      clearInterval(this.aliveInterval);

      this.tryFallbackConnection();

      return this.ctx.events.emit(Events.Slave.DISCONNECT);
    });

    this.ws.on(Events.Link.CONFIG, (config: InputConfig) => {
      this.ctx.events.emit(Events.Link.CONFIG, config);
    });

    this.ws.on(Events.Link.SLAVE_STATUS, (cb: (status: SlaveStatus) => void) => {
      this.ctx.events.emit(Events.Link.SLAVE_STATUS, cb);
    });

    this.ws.on(Events.Link.AUDIO, (msg: WsAudioMessage) => {
      // our data gets converted into an ArrayBuffer to go over the
      // socket. convert it back before insertion
      // convert timestamp back to a date object
      const chunk = {
        ...msg.chunk,
        ts: new Date(msg.chunk.ts).valueOf()
      }
      this.logger.silly(`audio chunk received from master: ${msg.stream}/${toTime(chunk.ts)}`)

      // emit globally, this event will be listened by stream sources
      return this.ctx.events.emit(`audio:${msg.stream}`, chunk);
    });

    this.ws.on("reconnect_failed", () => {
      this.tryFallbackConnection();
    });
  }

  tryFallbackConnection() {
    console.log('ERRROR WS; SHUTDOWN');
    process.exit(1);

    this.disconnect();
    const masterUrls = this.config.master;

    this.masterUrlIndex++;
    if (this.masterUrlIndex >= masterUrls.length) {
      // all master urls tried, emit error
      this.logger.error('no more available master connections to try, emit error');
      this.ctx.events.emit(Events.Slave.CONNECT_ERROR);
      return;
    }

    // else, try to connect to the next url
    this.logger.info('try next master available url');
    this.connect();
  }

  getRewind(streamId: string): Promise<Readable> {
    this.logger.info(`make rewind buffer request for stream ${streamId}`);

    const request = axios.get<Readable>(`/s/${streamId}/rewind`, {
      baseURL: `http://${this.ws.io.opts.hostname}:${this.ws.io.opts.port}`,
      headers: {
        'stream-slave-id': this.id
      },
      responseType: "stream"
    })
      .then(res => {
        this.logger.info(`got rewind stream response from master`);

        return res.data;
      });

    return promiseTimeout(request, REWIND_REQUEST_TIMEOUT);
  }

  disconnect() {
    if (!this.ws) {
      return;
    }

    this.ws.disconnect();
  }
}
