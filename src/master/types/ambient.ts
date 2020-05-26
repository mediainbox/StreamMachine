import { MasterStream } from "../stream/Stream";

export {};

declare global {
  namespace Express {
    export interface Request {
      mStream: MasterStream;
    }
  }
}
