import {ISource} from "./base/ISource";
import {SourceConfig, SourceType} from "../types";
import {IcecastUrlSource} from "./types/IcecastUrlSource";
import {Format} from "../../types";
import {Seconds} from "../../types/util";
import {componentLogger} from "../../logger";

export function makeSource(streamId: string, sourceConfig: SourceConfig): ISource {
  if (sourceConfig.type === SourceType.ICECAST_URL) {
    return new IcecastUrlSource({
      ...sourceConfig,
      format: Format.MP3,
      chunkDuration: 0.5 as Seconds, // FIXME
    },
      componentLogger(`stream[${streamId}]:source_${SourceType.ICECAST_URL}`),
    );
  }

  throw new Error(`Invalid source type: ${sourceConfig.type}`);
}
