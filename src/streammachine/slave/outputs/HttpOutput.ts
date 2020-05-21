import express from "express";
import {Format} from "../types";
import {IOutput} from "./IOutput";
import { Logger } from "winston";
import { Readable } from "stream";
import { Socket } from "net";
import { Err } from "../../../types";
import { EventEmitter } from "events";
const _ = require("lodash");

export abstract class HttpOutput extends EventEmitter implements IOutput {
  readonly TYPE: string;
  protected disconnected = false;
  protected readonly socket: Socket;
  protected source: Readable;

  constructor(
    protected readonly req: express.Request,
    protected readonly res: express.Response,
    protected readonly format: Format,
    protected readonly logger: Logger
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
  abstract send(source: Readable): void;

  hookEvents() {
    this.socket.on("end", () => {
      this.disconnect();
    });

    this.socket.on("close", () => {
      this.disconnect();
    });

    this.socket.on("error", (err: Err) => {
      if (err.code !== 'ECONNRESET') {
        this.logger.debug(`got client socket error: ${err}`);
      }

      this.disconnect();
    });
  }

  disconnect(internal = true) {
    if (this.disconnected) {
      return;
    }
    this.disconnected = true;

    if (!this.socket.destroyed) {
      this.socket.end();
    }

    if (this.source) { // source = Rewinder
      this.source.destroy();
    }

    if (internal) {
      this.emit("disconnect");
    }

    this.logger.debug('output disconnected');
    this.removeAllListeners();
  }
}
