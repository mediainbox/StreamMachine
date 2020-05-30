import {CollectionUpdater} from "../../util/CollectionUpdater";
import {BaseSourceConfig, SourceConfig} from "../config/source";
import {MasterEvent, masterEvents} from "../events";
import {Logger} from "winston";
import {componentLogger} from "../../logger";
import {Collection} from "../../util/Collection";
import {ISource} from "../sources/base/ISource";
import {makeSource, StreamData} from "../stream/sources/sourceFactory";
import {sourceLabel} from "../sources/base/BaseSource";

export class SourcesUpdater {
  private readonly collectionUpdater: CollectionUpdater<ISource, SourceConfig>;
  private readonly logger: Logger;

  constructor(
    private readonly streamData: StreamData,
    private readonly sources: Collection<ISource>
  ) {
    this.logger = componentLogger(`stream[${streamData.streamId}]:sources_updater`);

    this.collectionUpdater = new CollectionUpdater(sources, {
      onCreate: config => {
        this.logger.info(`Create source: ${sourceLabel(config)}`);

        const source = makeSource(this.streamData, config);
        this.sources.add(config.id, source);
        masterEvents().emit(MasterEvent.SOURCE_CREATED, source);

        return source;
      },
      onUpdate: (source, config) => {
        this.logger.info(`Update source: ${config.id}`);

        const oldConfig = source.getConfig();
        source.configure(config);

        masterEvents().emit(MasterEvent.SOURCE_UPDATED, source, oldConfig);
      },
      onDelete: source => {
        this.logger.info(`Delete source: ${source.getId()}`);

        this.sources.remove(source.getId());
        source.destroy();

        masterEvents().emit(MasterEvent.SOURCE_DELETED, source);
      },
      onUnchanged: source => {
        this.logger.info(`Unchanged source: ${source.getId()}`);
      },
    });
  }

  update(newConfigs: readonly SourceConfig[]) {
    return this.collectionUpdater.update(newConfigs);
  }
}
