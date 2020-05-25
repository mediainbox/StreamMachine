import {ISource} from "../sources/base/ISource";
import {SourceConfig, SourceType} from "../types";
import {IcecastUrlSource} from "../sources/types/IcecastUrlSource";
import {Format} from "../../types";
import {Seconds} from "../../types/util";

export function makeSource(sourceConfig: SourceConfig): ISource {
  if (sourceConfig.type === SourceType.ICECAST_URL) {
    return new IcecastUrlSource({
      ...sourceConfig,
      format: Format.MP3,
      chunkDuration: 0.5 as Seconds, // FIXME
    });
  }

  throw new Error(`Invalid source type: ${sourceConfig.type}`);
}
