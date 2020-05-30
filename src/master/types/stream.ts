import {SourceStatus, SourceVitals} from "../../types";
import {MasterStreamState} from "../stream/Stream";
import {RewindBufferStatus} from "../../rewind/RewindBuffer";
import {MasterStreamConfig} from "../config/stream";

export interface MasterStreamStatus {
  readonly id: string;
  readonly config: MasterStreamConfig;
  readonly state: MasterStreamState;
  readonly vitals: SourceVitals | null;
  readonly lastChunkTs: Date | null;
  readonly rewindBuffer: RewindBufferStatus | null;
  readonly sourcesStatus: readonly SourceStatus<any>[];
}
