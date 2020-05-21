import { EventEmitter } from "events";
import { Logger } from "winston";
import {IOutput} from "./IOutput";
import { Readable } from "stream";

export abstract class BaseOutput extends EventEmitter implements IOutput {
  public readonly TYPE: string;
  disconnected = true;

  abstract send(stream: Readable): void;
}
