import express from "express";
import {IOutput} from "./IOutput";
import {Logger} from "winston";
import {Socket} from "net";
import {Err, Format} from "../../types";
import {ISource} from "./ISource";
import {Bytes, Seconds} from "../../types/util";
import {TypedEmitterClass} from "../../helpers/events";

interface Events {
  disconnect: () => void;
}

export abstract class HttpOutput extends TypedEmitterClass<Events>() implements IOutput {
  protected disconnected = false;
  protected isStreaming = false;

  protected socket: Socket;
  protected source?: ISource;

  constructor(
    protected readonly req: express.Request,
    protected readonly res: express.Response,
    protected readonly format: Format,
    protected readonly logger: Logger,
  ) {
    super();

    this.socket = req.connection;

    this.hookEvents();
    this.configure({
      "Content-Type": format === "mp3" ? "audio/mpeg" : (format === "aac" ? "audio/aacp" : "unknown"),
      "Accept-Ranges": "none",
    });
  }

  abstract configure(headers: any): void;
  abstract shouldPump(): boolean;
  abstract getType(): string;

  hookEvents() {
    this.socket.on("end", this.disconnect);
    this.socket.on("close", this.disconnect);
    this.socket.on("error", this.handleSocketError);
  }

  handleSocketError = (err: Err) => {
    if (err.code !== 'ECONNRESET') {
      this.logger.warn(`got client socket error: ${err}`);
    }

    this.disconnect();
  }

  getQueuedBytes() {
    if (!this.isStreaming) {
      return 0;
    }

    const bufferSize = this.socket.bufferSize || 0;
    const queuedBytes = this.source?.getQueuedBytes() || 0;

    return bufferSize + queuedBytes as Bytes;
  }

  getSentBytes() {
    return this.socket.bytesWritten as Bytes;
  }

  getSentSeconds() {
    return (this.source?.getSentSeconds() || 0) as Seconds;
  }

  send(source: ISource) {
    if (this.disconnected) {
      this.logger.warn('send() was called after disconnect');
      return;
    }

    this.isStreaming = true;
    this.source = source; // usually preroll + rewinder
    source.pipe(this.socket);
  }

  disconnect = () => {
    if (this.disconnected) {
      return;
    }

    this.logger.debug('Output disconnected');
    this.disconnected = true;

    // emit disconnect here so hooks can still read
    // from source/socket state
    this.emit("disconnect");

    if (this.source) { // source = Rewinder
      this.source.unpipe();
      this.source.destroy();
    }

    this.socket.removeListener("end", this.disconnect);
    this.socket.removeListener("close", this.disconnect);
    this.socket.removeListener("error", this.handleSocketError);

    if (!this.socket.destroyed) {
      this.socket.destroy();
    }

    this.removeAllListeners();
  }
}
