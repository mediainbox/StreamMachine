import { SlaveStream } from "../stream/Stream";

export {};

declare global {
  namespace Express {
    export interface Request {
      sStream: SlaveStream;
      tracking: {
        unique_listener_id: string;
        session_id: string;
      };
    }
  }
}
