import {ISource} from "./base/ISource";
import {MasterStreamConfig, SourceConfig, SourceType} from "../types";
import {IcecastUrlSource} from "./types/IcecastUrlSource";
import {componentLogger} from "../../logger";

export function makeSource(streamConfig: MasterStreamConfig, sourceConfig: SourceConfig): ISource {
  if (sourceConfig.type === SourceType.ICECAST_URL) {
    const icecastUrlSourceConfig = {
      ...sourceConfig,
      format: streamConfig.format,
      chunkDuration: streamConfig.chunkDuration,
    };

    return new IcecastUrlSource(
      icecastUrlSourceConfig,
      componentLogger(`stream[${streamConfig.id}]:source_${SourceType.ICECAST_URL}`),
    );
  }

  throw new Error(`Invalid source type: ${sourceConfig.type}`);
}
