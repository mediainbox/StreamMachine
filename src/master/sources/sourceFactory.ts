import {ISource} from "./base/ISource";
import {SourceType} from "../types";
import {IcecastUrlSource} from "./types/IcecastUrlSource";
import {componentLogger} from "../../logger";
import {SourceConfig} from "../types/config";
import {SourceChunker} from "./base/SourceChunker";
import {Format} from "../../types";
import {Seconds} from "../../types/util";

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
      componentLogger(`stream[${streamData.streamId}]:source_${SourceType.ICECAST_URL}`),
    );
  }

  throw new Error(`Invalid source type: ${sourceConfig.type}`);
}
