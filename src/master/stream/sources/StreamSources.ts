import {ISource} from "../../sources/base/ISource";
import {Chunk, SourceVitals} from "../../../types";
import {TypedEmitterClass} from "../../../helpers/events";
import {StreamData} from "./sourceFactory";
import {SourceConfig} from "../../config/source";
import {Collection} from "../../../util/Collection";
import {Logger} from "winston";
import {componentLogger} from "../../../logger";
import {SourcesUpdater} from "../../streams/SourcesUpdater";
import {pickSource} from "./sourcePicker";

interface Events {
  chunk: (chunk: Chunk) => void;
  vitals: (vitals: SourceVitals) => void;
  destroy: () => void;
}

// We have three options for what source we're going to use:
// a) Internal: Create our own source mount and manage our own sources.
//    Basically the original stream behavior.
// b) Source Mount: Connect to a source mount and use its source
//    directly. You'll get whatever incoming format the source gets.
// c) Source Mount w/ Transcoding: Connect to a source mount, but run a
//    transcoding source between it and us, so that we always get a
//    certain format as our input.

/**
 * TODO:
 * - on source disconnect: promote new source if any, otherwise event
 * - on source reconnect: promote if no active source
 */

// FIXME: refactor
export class StreamSources extends TypedEmitterClass<Events>() {
  private activeSource: ISource | null = null;
  private readonly logger: Logger;

  private readonly sources = new Collection<ISource>();
  private sourcesUpdater: SourcesUpdater;

  constructor(
    private readonly streamData: StreamData,
    readonly sourcesConfig: readonly SourceConfig[]
  ) {
    super();

    this.sourcesUpdater = new SourcesUpdater(streamData, this.sources);
    this.logger = componentLogger(`stream[${streamData.streamId}]:sources`);

    this.configure(sourcesConfig);
  }

  configure(newConfigs: readonly SourceConfig[]) {
    const { created, deleted } = this.sourcesUpdater.update(newConfigs);

    created.forEach(source => {
      source.on('connect', () => {
        this.pickSource();
      });

      source.on('disconnect', () => {
        this.pickSource();
      });
    });

    this.pickSource();
  }

  pickSource() {
    const source = pickSource(this.sources.toArray());

    if (!source) {
      this.promote(null);

      // TODO: emit sourceless
      this.logger.warn('No active sources left');
      return;
    }

    this.promote(source);
  }

  promote(nextSource: ISource | null) {
    const prevSource = this.activeSource;

    // if old source equals next source
    if (prevSource && prevSource === nextSource) {
      this.logger.info(`Keep current source: ${prevSource.getLabel()}`);
      return;
    }

    // if there is a current source and does not match next, unhook events
    if (prevSource) {
      this.logger.info(`Unhook previous source: ${prevSource.getLabel()}`);
      prevSource.removeListener('chunk', this.onChunk);
      prevSource.removeListener('vitals', this.onVitals);
    }

    // if there is a next source to promote, hook events
    if (nextSource) {
      this.logger.info(`Promote new source: ${nextSource.getLabel()}`);
      nextSource.on('chunk', this.onChunk);
      nextSource.on('vitals', this.onVitals);
    }

    this.activeSource = nextSource;
  }

  onChunk = (chunk: Chunk) => {
    this.emit('chunk', chunk);
  }

  onVitals = (vitals: SourceVitals) => {
    this.emit('vitals', vitals);
  }

  destroy() {
    this.sources.map(source => source.destroy());
  }
}
