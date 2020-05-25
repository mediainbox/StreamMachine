import { Stream } from "../stream/Stream";

export {};

declare global {
  namespace Express {
    export interface Request {
      sStream: Stream;
      tracking: {
        unique_listener_id: string;
        session_id: string;
      };
    }
  }
}
