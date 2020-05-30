import { SlaveStream } from "../stream/Stream";
import {Milliseconds} from "../../types/util";

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

declare global {
  interface ObjectConstructor {
    typedKeys<T>(o: T) : Array<keyof T>
  }
}

