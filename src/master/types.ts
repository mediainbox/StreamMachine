import {Logger} from "winston";
import {EventEmitter} from "events";

export interface MasterCtx {
  readonly config: MasterConfig_V1;
  readonly logger: Logger;
  readonly events: EventEmitter;
  readonly providers: {}
}
