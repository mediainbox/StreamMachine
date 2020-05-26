import {ISource} from "../sources/base/ISource";
import {MasterStreamConfig, SourceConfig} from "../types";
import {Chunk, SourceVitals} from "../../types";
import {TypedEmitterClass} from "../../helpers/events";
import {makeSource} from "../sources/sourceFactory";

interface Events {
  chunk: (chunk: Chunk) => void;
  connected: (vitals: SourceVitals) => void;
}

// We have three options for what source we're going to use:
// a) Internal: Create our own source mount and manage our own sources.
//    Basically the original stream behavior.
// b) Source Mount: Connect to a source mount and use its source
//    directly. You'll get whatever incoming format the source gets.
// c) Source Mount w/ Transcoding: Connect to a source mount, but run a
//    transcoding source between it and us, so that we always get a
//    certain format as our input.
export class StreamSources extends TypedEmitterClass<Events>() {
  private readonly sources: ISource[] = [];
  private activeSource: ISource | null = null;

  constructor(
    private readonly streamConfig: MasterStreamConfig,
    private readonly config: readonly SourceConfig[]
  ) {
    super();

    // build all sources from config
    this.sources = config.map(config => makeSource(streamConfig, config));

    this.sources.forEach(source => {
      source.on('connect', () => {

      });

      source.on('disconnect', () => {

      });

      source.on('chunk', chunk => {
        this.emit('chunk', chunk);
      });

      source.on('vitals', vitals => {
        this.emit('connected', vitals);
      });
    });

    this.pickSource();
  }

  pickSource() {
    this.activeSource = this.sources[0];
    this.activeSource.connect();
  }

  /**
   * TODO:
   * - on source add: promote if more priority or none active
   * - on source disconnect: promote new source if any, otherwise event
   * - on source promote: unhook old and hook new
   */
}
