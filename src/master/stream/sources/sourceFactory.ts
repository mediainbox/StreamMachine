import {ISource} from "../../sources/base/ISource";
import {SourceType} from "../../types";
import {IcecastUrlSource} from "../../sources/types/IcecastUrlSource";
import {componentLogger} from "../../../logger";
import {SourceConfig} from "../../config/source";
import {SourceChunker} from "../../sources/base/SourceChunker";
import {Format} from "../../../types";
import {Seconds} from "../../../types/util";
import {sourceLabel} from "../../sources/base/BaseSource";

export interface StreamData {
  readonly streamId: string;
  readonly format: Format;
  readonly chunkDuration: Seconds;
}

export function makeSource(streamData: StreamData, sourceConfig: SourceConfig): ISource<any> {
  if (sourceConfig.type === SourceType.ICECAST_URL) {
    return new IcecastUrlSource(
      sourceConfig,
      new SourceChunker({
        chunkDuration: streamData.chunkDuration,
        format: streamData.format,
      }),
      componentLogger(`stream[${streamData.streamId}]:sources:${sourceLabel(sourceConfig)}`),
    );
  }

  throw new Error(`Invalid source type: ${sourceConfig.type}`);
}
