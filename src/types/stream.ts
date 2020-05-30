import {Kbytes, Seconds} from "./util";
import {Format, IfEnabled} from "./index";
import {DeepReadonly} from "ts-essentials";
import {AdsConfig} from "./ads";

export type BaseStreamConfig = DeepReadonly<{
  clientId: string;
  id: string;
  metadata: {
    title: string;
    url: string;
  };
  format: Format;
  rewindBuffer: {
    maxSeconds: Seconds;
  };
  listen: {
    initialBurstSeconds: Seconds;
    maxBufferSize: Kbytes;
  };
  eventsReport: {
    listener: IfEnabled<{
      interval: Seconds;
    }>
  },
  ads: IfEnabled<AdsConfig>;
  //geolock: IfEnabled<{
  //  mode: 'whitelist' | 'blacklist';
  //  countryCodes: readonly string[]
  //  fallback: string;
  //}>;
}>;

