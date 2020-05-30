import {Milliseconds} from "./util";

export interface AdsConfig {
  serverUrl: string;
  transcoderUrl: string;
  adTimeoutMs: Milliseconds;
  impressionDelayMs: Milliseconds;
  prerollKey?: string;
}
