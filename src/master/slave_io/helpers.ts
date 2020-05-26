import {SlaveStreamsConfig} from "../../slave/types/streams";
import { Stream } from "../stream/Stream";
import _ from "lodash";

export function getStreamsDataForSlaves(streams: readonly Stream[]): SlaveStreamsConfig {
  return streams.map(stream => {
    const config = _.omit(stream.getConfig(), 'sources');

    return {
      ...config,
      vitals: stream.getVitals()!,
    };
  })
}
