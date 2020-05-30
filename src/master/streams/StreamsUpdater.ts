import {StreamsCollection} from "./StreamsCollection";
import {CollectionUpdater} from "../../util/CollectionUpdater";
import {MasterStream} from "../stream/Stream";
import {MasterEvent, masterEvents} from "../events";
import {Logger} from "winston";
import {componentLogger} from "../../logger";
import {DEFAULT_STREAM_CONFIG, validateStreamConfig} from "../config";
import {MasterStreamConfig} from "../config/stream";

export class StreamsUpdater {
  private readonly collectionUpdater: CollectionUpdater<MasterStream, MasterStreamConfig>;
  private readonly logger: Logger;

  constructor(private readonly streams: StreamsCollection) {
    this.logger = componentLogger(`streams_updater`);

    this.collectionUpdater = new CollectionUpdater(streams, {
      onCreate: config => {
        this.logger.info(`Create stream: ${config.id}`);
        const stream = new MasterStream(
          config.id,
          config,
        );
        this.streams.add(config.id, stream);
        masterEvents().emit(MasterEvent.STREAM_CREATED, stream);

        return stream;
      },
      onUpdate: (stream, config) => {
        this.logger.info(`Update stream ${config.id}`);

        const oldConfig = stream.getConfig();
        stream.configure(config);

        masterEvents().emit(MasterEvent.STREAM_UPDATED, stream, oldConfig);
      },
      onDelete: stream => {
        this.logger.info(`Delete stream: ${stream.getId()}`);

        this.streams.remove(stream.getId());
        stream.destroy();

        masterEvents().emit(MasterEvent.STREAM_DELETED, stream);

      },
      onUnchanged: stream => {
        this.logger.info(`Unchanged stream: ${stream.getId()}`);
      },
    }, validateStreamConfig);
  }

  update(newConfigs: readonly MasterStreamConfig[]) {
    this.collectionUpdater.update(newConfigs);
  }
}
