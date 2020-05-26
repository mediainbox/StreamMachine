import {Seconds} from "./util";
import {Format, IfEnabled} from "./index";
import {DeepReadonly} from "ts-essentials";
import {AdsConfig} from "../slave/config/types";

export type BaseStreamConfig = DeepReadonly<{
  clientId: string;
  id: string;
  metadata: {
    title: string;
    url: string;
  }
  format: Format;
  rewind: {
    bufferSeconds: Seconds;
    initialBurst: Seconds;
  };
  ads: IfEnabled<AdsConfig>,
  geolock: IfEnabled<{
    mode: 'whitelist' | 'blacklist';
    countryCodes: readonly string[]
    fallback: string;
  }>;
}>;
