import {ISource} from "../sources/base/ISource";
import {SourceConfig} from "../types";
import {Chunk, SourceVitals} from "../../types";
import {TypedEmitterClass} from "../../helpers/events";
import {makeSource} from "../sources/sourceFactory";

interface Events {
  chunk: (chunk: Chunk) => void;
  connected: (vitals: SourceVitals) => void;
}

export class StreamSources extends TypedEmitterClass<Events>() {
  private readonly sources: ISource[] = [];
  private activeSource: ISource | null = null;

  constructor(
    private readonly streamId: string,
    private readonly config: readonly SourceConfig[]
  ) {
    super();

    // build all sources from config
    this.sources = config.map(config => makeSource(this.streamId, config));

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
