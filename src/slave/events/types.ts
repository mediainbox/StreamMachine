import express from "express";
import {IListener} from "../listeners/IListener";
import {DateTimeStr, Kbytes, Seconds} from "../../types/util";
import {SlaveStream} from "../stream/Stream";
import {IOutput} from "../output/IOutput";

export interface SlaveListenerLandedEvent {
  readonly stream: SlaveStream;
  readonly req: express.Request;
  readonly res: express.Response;
}

export interface SlaveListenerListenStartEvent {
  readonly datetime: DateTimeStr;
  readonly stream: SlaveStream;
  readonly output: IOutput;
  readonly listener: IListener;
}

export interface SlaveListenerListenEvent {
  readonly startedAt: DateTimeStr;
  readonly datetime: DateTimeStr;
  readonly stream: SlaveStream;
  readonly output: IOutput;
  readonly listener: IListener;
  readonly kbytes: Kbytes;
  readonly duration: Seconds;
  readonly session: {
    readonly kbytes: Kbytes;
    readonly duration: Seconds;
  }
}

export interface SlaveListenerDisconnectEvent {
  readonly startedAt: DateTimeStr;
  readonly datetime: DateTimeStr;
  readonly stream: SlaveStream;
  readonly output: IOutput;
  readonly listener: IListener;
  readonly lastListen: {
    readonly kbytes: Kbytes;
    readonly duration: Seconds;
  }
  readonly session: {
    readonly kbytes: Kbytes;
    readonly duration: Seconds;
  }
}
