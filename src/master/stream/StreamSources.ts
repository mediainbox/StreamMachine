import {ISource} from "../sources/base/ISource";
import {Chunk, SourceVitals} from "../../types";
import {TypedEmitterClass} from "../../helpers/events";
import {makeSource, StreamData} from "../sources/sourceFactory";
import {SourceConfig} from "../types/config";
import {Collection} from "../../util/Collection";
import {Logger} from "winston";
import {componentLogger} from "../../logger";
import _ from "lodash";
import {difference} from "../../helpers/object";

interface Events {
  chunk: (chunk: Chunk) => void;
  vitals: (vitals: SourceVitals) => void;
  destroy: () => void;
}

function sourceLabel(source: ISource): string {
  return `${source.getConfig().name || `#${source.getConfig().id}`} (${source.getConfig().type})`
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
  private activeSource: ISource | null = null;
  private readonly sources = new Collection<ISource>();
  private readonly logger: Logger;

  constructor(
    private readonly streamData: StreamData,
    readonly sourcesConfig: readonly SourceConfig[]
  ) {
    super();

    this.logger = componentLogger(`stream[${streamData.streamId}]:sources`);
    this.configure(sourcesConfig);
  }

  configure(sourcesConfig: readonly SourceConfig[]) {
    sourcesConfig
      .filter(c => c.enabled)
      .forEach(config => {
        const existentSource = this.sources.get(config.id);

        if (existentSource) {
          if (_.isEqual(existentSource.getConfig(), config)) {
            this.logger.info(`Source unchanged: ${sourceLabel(existentSource)}`, {config});
          } else {
            this.logger.info(`Update source: ${sourceLabel(existentSource)}`, {
              diff: difference(config, existentSource.getConfig())
            });
            existentSource.configure(config);
          }
          return;
        }

        const newSource = makeSource(this.streamData, config);
        this.logger.info(`Create source: ${sourceLabel(newSource)}`, {config});
        this.sources.add(config.id, newSource);
      });

    const nextSourcesIds = sourcesConfig
      .filter(c => c.enabled)
      .map(c => c.id);

    const toDelete = this
      .sources
      .toArray()
      .filter(source => !nextSourcesIds.includes(source.getId()));

    toDelete.forEach(source => {
      this.logger.info(`Delete source: ${sourceLabel(source)}`);
      source.destroy();
    });

    this.pickSource();
  }

  pickSource() {
    const sources = this.sources.toArray();

    if (!sources.length) {
      this.logger.warn('No sources left');
      // TODO: emit sourceless
      this.switchTo(null);
      return;
    }

    const sorted = sources.sort((sA, sB) => {
      if (!sA.isConnected()) {
        return 1;
      }

      if (!sB.isConnected()) {
        return -1;
      }

      if (sA.getPriority() > sB.getPriority()) {
        return -1;
      }

      if (sA.getPriority() < sB.getPriority()) {
        return 1;
      }

      if (sA === this.activeSource) {
        return -1;
      }

      if (sB === this.activeSource) {
        return 1;
      }

      return -1;
    });

    this.switchTo(sorted[0]);
  }

  switchTo(newSource: ISource | null) {
    if (this.activeSource && this.activeSource === newSource) {
      this.logger.info(`Keep current source: ${sourceLabel(this.activeSource)}`);
      return;
    }

    if (this.activeSource) {
      this.logger.info(`Unhook old source: ${sourceLabel(this.activeSource)}`);
      this.activeSource.removeAllListeners('chunk');
      this.activeSource.removeAllListeners('vitals');
    }

    if (newSource) {
      this.logger.info(`Promote source: ${sourceLabel(newSource)}`);
      this.activeSource = newSource;

      this.activeSource.on('chunk', chunk => {
        this.emit('chunk', chunk);
      });

      this.activeSource.on('vitals', vitals => {
        this.emit('vitals', vitals);
      });
    } else {
      this.activeSource = null;
    }
  }

  destroy() {
    this.activeSource?.destroy();
  }

  /**
   * TODO:
   * - on source add: promote if more priority or none active
   * - on source disconnect: promote new source if any, otherwise event
   * - on source promote: unhook old and hook new
   */
}
