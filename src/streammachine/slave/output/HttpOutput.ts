import express from "express";
import {Format} from "../types";
import {IOutput} from "./IOutput";
import {Logger} from "winston";
import {Socket} from "net";
import {Err} from "../../../types";
import {EventEmitter} from "events";
import {OutputSource} from "./OutputSource";

const _ = require("lodash");

export abstract class HttpOutput extends EventEmitter implements IOutput {
  protected disconnected = false;
  protected isStreaming = false;

  protected socket: Socket;
  protected source: OutputSource;

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
      return false;
    }

    const bufferSize = this.socket.bufferSize || 0;
    const queuedBytes = this.source.getQueuedBytes() || 0;

    return bufferSize + queuedBytes;
  }

  getSentBytes() {
    return this.socket.bytesWritten;
  }

  send(source: OutputSource) {
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

    this.disconnected = true;

    if (this.source) { // source = Rewinder
      this.source.unpipe();
      this.source.destroy();
      this.source = null!;
    }

    if (!this.socket?.destroyed) {
      this.socket.removeListener("end", this.disconnect);
      this.socket.removeListener("close", this.disconnect);
      this.socket.removeListener("error", this.handleSocketError);
      this.socket.destroy();
      this.socket = null!;
    }

    this.logger.debug('output disconnected');
    this.emit("disconnect");
    this.removeAllListeners();
  }
}
