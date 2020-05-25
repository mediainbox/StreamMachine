import { Stream } from "../streams/Stream";

export {};

declare global {
  namespace Express {
    export interface Request {
      mStream: Stream;
    }
  }
}
