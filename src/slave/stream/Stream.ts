import {ListenersCollection} from "../listeners/ListenersCollection";
import {Chunk, Err} from "../../types";
import {ListenersCleaner} from "../listeners/ListenersCleaner";
import {toTime} from "../../helpers/datetime";
import {Preroller} from "../preroll/Preroller";
import {MasterConnection} from "../master_io/MasterConnection";
import {Logger} from "winston";
import {IListener} from "../listeners/IListener";
import {NullPreroller} from "../preroll/NullPreroller";
import {IPreroller} from "../preroll/IPreroller";
import {ListenersReporter} from "../listeners/ListenersReporter";
import {createListenerSource} from "./sourceFactory";
import {ISource} from "../output/ISource";
import {TypedEmitterClass} from "../../helpers/events";
import {componentLogger} from "../../logger";
import {StreamStats, StreamStatus} from "../types";
import {ListenEventData, SlaveEvent, slaveEvents} from "../events";
import {SlaveStreamStatus, StreamEvent, StreamEvents} from "./types";
import {createRewindReader} from "../../rewind/RewindReader";
import {SlaveStreamConfig} from "../types/streams";
import {RewindBuffer} from "../../rewind/RewindBuffer";
import {StreamChunk} from "../../types/stream";

/**
 * Stream is the componenent where that listeners connect to.
 * Loads data from rewind buffer and pushes them to clients
 */
export class SlaveStream extends TypedEmitterClass<StreamEvents>() {
  private readonly stats: StreamStats = {
    connections: 0, // total counter, not active count
    sentBytes: 0,
  };
  private readonly listenersCol = new ListenersCollection();

  private readonly logger: Logger;
  private readonly listenersCleaner: ListenersCleaner;
  private readonly listenersReporter: ListenersReporter;
  private status = SlaveStreamStatus.CREATED;

  private preroller: IPreroller = new NullPreroller();
  private rewindBuffer?: any;

  constructor(
    private readonly id: string,
    private readonly config: SlaveStreamConfig,
    private readonly masterConnection: MasterConnection,
  ) {
    super();

    // remove max listener limit
    this.setMaxListeners(0);

    this.logger = componentLogger(`stream[${id}]`);

    this.id = id;

    this.listenersCleaner = new ListenersCleaner(
      this.id,
      this.listenersCol,
      config.listen.maxBufferSize
    );

    // TODO: move to slave?
    this.listenersReporter = new ListenersReporter(
      this.id,
      this.listenersCol,
      false,
    );

    this.hookEvents();
    this.configure();
  }

  getId() {
    return this.id;
  }

  getFormat() {
    return this.config.format;
  }

  getConfig() {
    return this.config;
  }

  hookEvents() {
    // wait for rewind to be loaded before pushing any data
    this.runOrWait(StreamEvent.READY, () => {
      slaveEvents().on(SlaveEvent.CHUNK, (data: StreamChunk) => {
        if (data.streamId !== this.id) {
          // chunk for other stream
          return;
        }

        this.handleNewChunk(data.chunk);
      });
    });

    slaveEvents().on(SlaveEvent.LISTENER_LISTEN, (data: ListenEventData) => {
      if (data.streamId !== this.id) {
        return;
      }

      this.stats.sentBytes += data.sentBytes;
    });
  }

  configure() {
    // TODO: handle reconfiguration
    if (this.rewindBuffer) {
      return;
    }

    this.initPreroller();
    this.initRewindBuffer();
  }

  initPreroller() {
    if (!this.config.ads.enabled) {
      this.logger.info('Ads are disabled');
      return;
    }

    this.logger.info('Ads are enabled, init preroller');

    this.preroller = new Preroller(
      this.id,
      this.config.ads,
    );
  }

  initRewindBuffer() {
    this.logger.info(`Create rewind buffer, max size is ${this.config.rewindBuffer.maxSeconds} seconds`);

    // create rewind buffer associated to this stream that will
    // store the audio chunks sent from master
    this.rewindBuffer = new RewindBuffer(
      this.id,
      {
        maxSeconds: this.config.rewindBuffer.maxSeconds,
      },
      this.config.vitals,
    );

    // fetch current buffer from master and preload rewind
    this
      .masterConnection
      .getRewind(this.id)
      .then(readable => {
        return this.rewindBuffer.preload(createRewindReader(readable))
          .then(() => {
            this.logger.info('Rewind buffer loaded, allow listener connections to start');
          });
      })
      .catch((error: Err) => {
        this.logger.error(`Could not load rewind from master, error: ${error.code}`, {
          error
        });
      })
      .finally(() => {
        this.status = SlaveStreamStatus.READY;
        this.emit(StreamEvent.READY);
      })
  }

  listen(listener: IListener): Promise<ISource> {
    return new Promise((resolve, reject) => {
      // don't ask for a rewinder while our source is going through init,
      // since we don't want to fail an offset request that should be valid
      this.runOrWait(StreamEvent.READY, async () => {
        this.stats.connections++;

        this.listenersCol.add(listener.id, listener);
        this.logger.debug(`Add listener #${listener.id}, create source`);

        listener.once('disconnect', () => {
          this.logger.debug(`Remove listener #${listener.id}`);
          this.listenersCol.remove(listener.id);
        });

        try {
          const source = await createListenerSource({
            streamId: this.id,
            listener,
            preroller: this.preroller,
            rewindBuffer: this.rewindBuffer,
          });

          this.logger.debug(`Built audio source for listener #${listener.id}`);

          listener.send(source);
        } catch (error) {
          this.logger.error(`Error ocurred while loading rewinder for listener #${listener.id}`, {
            error,
          });
          reject(error);
        }
      });
    });
  }

  handleNewChunk(chunk: Chunk) {
    this.logger.silly(`New chunk ${toTime(chunk.ts)}`);
    this.rewindBuffer.push(chunk);

    // TODO: fix this, if master does not send chunk, no data is
    // pushed to listeners buffers!
    this.listenersCol.map(listener => {
      listener.getSource().pullChunk();
    });
  }

  getStatus(): StreamStatus {
    return {
      key: this.id,
      bufferStatus: this.rewindBuffer.getStatus(),
      stats: {
        listeners: this.listenersCol.count(),
        connections: this.stats.connections,
        kbytesSent: this.stats.sentBytes / 1024
      }
    };
  }

  destroy() {
    this.listenersCol.disconnectAll();
    this.rewindBuffer.disconnect();
    this.listenersCleaner.destroy();

    this.emit(StreamEvent.DISCONNECT);
    this.removeAllListeners();
  }
}
