import {Stream} from "./slave/stream/Stream";

export {};

declare global {
  namespace Express {
    export interface Request {
      stream: Stream;
      tracking: {
        unique_listener_id: string;
        session_id: string;
      };
    }
  }
}
