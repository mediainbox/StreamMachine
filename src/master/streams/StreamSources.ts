import {ISource} from "../sources/base/ISource";
import {SourceConfig} from "../types";
import {Chunk, SourceVitals} from "../../types";
import {TypedEmitterClass} from "../../helpers/events";
import {makeSource} from "./sourceFactory";

interface Events {
  chunk: (chunk: Chunk) => void;
  vitals: (vitals: SourceVitals) => void;
}

export class StreamSources extends TypedEmitterClass<Events>() {
  private readonly sources: ISource[] = [];
  private activeSource: ISource | null = null;

  constructor(
    private readonly streamId: string,
    private readonly config: readonly SourceConfig[]
  ) {
    super();

    this.sources = config.map(makeSource);

    this.sources.forEach(source => {
      source.on('connect', () => {

      });

      source.on('disconnect', () => {

      });

      source.on('chunk', chunk => {
        this.emit('chunk', chunk);
      });

      source.on('vitals', vitals => {
        this.emit('vitals', vitals);
      });
    });

    this.pickSource();
  }

  pickSource() {
    this.activeSource = this.sources[0];
    this.activeSource.connect();
  }
}
