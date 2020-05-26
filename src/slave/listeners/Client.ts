import express from "express";
import {Mutable} from "../../helpers/types";

export class Client {
  readonly path: string = null!;
  readonly unique_listener_id: string = null!;
  readonly session_id: string = null!;
  readonly ip: string = null!;
  readonly ua: string = null!;

  static fromRequest(req: express.Request): Client {
    const client = new Client() as Mutable<Client>;

    client.ip =  req.ip;
    client.path =  req.url;
    client.ua =  req.query.ua as string || req.get('user-agent') || '';
    client.unique_listener_id =  req.tracking.unique_listener_id;
    client.session_id =  req.tracking.session_id;

    return client;
  }

  toJson() {
    return {
      ip: this.ip,
      path: this.path,
      ua: this.ua,
      unique_listener_id: this.unique_listener_id,
      session_id: this.session_id,
    }
  }
}
