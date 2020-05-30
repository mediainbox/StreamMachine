import {Logger} from "winston";
import {toTime} from "../../helpers/datetime";
import axios from 'axios';
import {Readable} from "stream";
import {promiseTimeout} from "../../helpers/promises";
import socketIO from "socket.io-client";
import {componentLogger} from "../../logger";
import {SlaveEvent, slaveEvents} from "../events";
import {MasterWsMessage, SlaveWsMessage, SlaveWsSocket} from "../../messages";
import {SlaveStreamsConfig} from "../types/streams";
import {SlaveConfig} from "../config";

const REWIND_REQUEST_TIMEOUT = 15 * 1000;
const ALIVE_INTERVAL = 5000;
const RECONNECT_WAIT = 5000;

/**
 * Interface communicaions to Master
 */
export class MasterConnection {
  private readonly logger: Logger;
  private ws: SlaveWsSocket = null!;
  private connected = false;
  private masterUrlIndex = 0;
  private aliveInterval?: NodeJS.Timeout;

  constructor(private readonly config: SlaveConfig['master'] & { slaveId: string }) {
    this.logger = componentLogger('master_connection');

    this.connect();
  }

  buildConnectionUrl(url: string): string {
    return `${url}?password=${this.config.password}&slaveId=${this.config.slaveId}`
  }

  connect() {
    const nextUrl = this.config.urls[this.masterUrlIndex];

    this.logger.info(`Connect to master[${this.masterUrlIndex}] at ${nextUrl}`);

    this.ws = socketIO.connect(this.buildConnectionUrl(nextUrl), {
      reconnection: false,
      timeout: this.config.timeout,
    }) as SlaveWsSocket;

    const onConnectError = (error: Error) => {
      this.logger.warn(`Connection failed (${error.message})`, {
        error
      });
      this.logger.info(`Reconnect in ${RECONNECT_WAIT}ms`);

      setTimeout(() => {
        this.tryFallbackConnection();
      }, RECONNECT_WAIT);
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

      return this.ws.emit(SlaveWsMessage.CONNECTION_VALIDATE, (res: string) => {
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
        this.connected = true;

        slaveEvents().emit(SlaveEvent.CONNECT);
      });
    });

    this.ws.on("disconnect", () => {
      this.connected = false;
      this.logger.info("disconnected from master");

      this.aliveInterval && clearInterval(this.aliveInterval);
      this.tryFallbackConnection();

      slaveEvents().emit(SlaveEvent.DISCONNECT);
    });

    this.ws.on(MasterWsMessage.STREAMS, (streamsConfig: SlaveStreamsConfig) => {
      slaveEvents().emit(SlaveEvent.CONFIGURE_STREAMS, streamsConfig);
    });

    /*this.ws.on(Events.Link.SLAVE_STATUS, (cb: (status: SlaveStatus) => void) => {
      slaveEvents().emit(Events.Link.SLAVE_STATUS, cb);
    });*/

    this.ws.on(MasterWsMessage.CHUNK, chunk => {
      // our data gets converted into an ArrayBuffer to go over the
      // socket. convert it back before insertion
      // convert timestamp back to a date object
      this.logger.silly(`Chunk received: ${chunk.streamId}/${toTime(chunk.chunk.ts)}`)

      // emit globally, this event will be listened by stream sources
      slaveEvents().emit(SlaveEvent.CHUNK, chunk);
    });
  }

  tryFallbackConnection() {
    this.disconnect();
    const masterUrls = this.config.urls;

    this.masterUrlIndex++;
    if (this.masterUrlIndex >= masterUrls.length) {
      this.masterUrlIndex = 0;
    }

    // else, try to connect to the next url
    this.logger.info('Try next master available url');
    this.connect();
  }

  getRewind(streamId: string): Promise<Readable> {
    this.logger.info(`Make rewind buffer request for stream ${streamId}`);

    const request = axios.get<Readable>(`/slave/${streamId}/rewind`, {
      baseURL: this.config.urls[this.masterUrlIndex].replace(/^ws/, 'http'),
      responseType: "stream",
      params: {
        slaveId: this.config.slaveId,
        password: this.config.password,
      }
    })
      .then(res => {
        this.logger.info(`Got rewind stream response for ${streamId} from master`);

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
