import { Stream } from "../stream/Stream";

export {};

declare global {
  namespace Express {
    export interface Request {
      mStream: Stream;
    }
  }
}
