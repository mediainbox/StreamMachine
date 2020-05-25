import {ListenersCollection} from "../listeners/ListenersCollection";
import {Err} from "../../types";
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
import {_SourceVitals, StreamStats, StreamStatus} from "../types";
import {Kbytes} from "../../types/util";
import {ListenEventData, SlaveEvent, slaveEvents} from "../events";
import {StreamEvent, StreamEvents} from "./events";
import {StreamChunk} from "../../master/types";
import {createRewindLoader} from "../../rewind/RewindLoader";
import {SlaveStreamConfig} from "../types/streams";

const RewindBuffer = require("../../rewind/rewind_buffer");

interface GlobalConfig {
  readonly listenerMaxBufferSize: Kbytes;
}

/**
 * Stream is the componenent where that listeners connect to.
 * Loads data from rewind buffer and pushes them to clients
 */
export class Stream extends TypedEmitterClass<StreamEvents>() {
  private readonly stats: StreamStats = {
    connections: 0, // total counter, not active count
    sentBytes: 0,
  };
  private readonly listenersCol = new ListenersCollection();
  private vitals: Partial<_SourceVitals>;

  private readonly logger: Logger;
  private readonly listenersCleaner: ListenersCleaner;
  private readonly listenersReporter: ListenersReporter;

  private preroller: IPreroller;
  private rewindBuffer: any;

  constructor(
    private readonly id: string,
    private readonly config: SlaveStreamConfig,
    private readonly globalConfig: GlobalConfig,
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
      globalConfig.listenerMaxBufferSize,
    );

    this.listenersReporter = new ListenersReporter(
      this.id,
      this.listenersCol,
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
    this.runOrWait(StreamEvent.REWIND_LOADED, () => {
      slaveEvents().on(`chunk`, (data: StreamChunk) => {
        if (data.streamId !== this.id) {
          // chunk for other stream
          return;
        }

        this.logger.silly(`push received audio chunk ${toTime(data.chunk.ts)}`);
        this.rewindBuffer.push(data.chunk);
        this.listenersCol.pushLatest(this.rewindBuffer.buffer);
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
      this.logger.info('ads are disabled');
      return new NullPreroller();
    }

    this.logger.info('ads are enabled, init preroller');

    return new Preroller(
      this.id,
      this.config.ads,
    );
  }

  initRewindBuffer() {
    this.logger.info(`Create rewind buffer, max size is ${this.config.rewind.bufferSeconds} seconds`);

    // create rewind buffer associated to this stream that will
    // store the audio chunks sent from master
    this.rewindBuffer = new RewindBuffer({
      id: `slave__${this.id}`,
      streamKey: this.id,
      maxSeconds: this.config.rewind.bufferSeconds,
      initialBurst: this.config.rewind.initialBurst,
      vitals: this.vitals,
      logger: this.logger,
    });

    // fetch current buffer from master and preload rewind
    this
      .masterConnection
      .getRewind(this.id)
      .then(readable => {
        this.rewindBuffer.preload(createRewindLoader(readable), () => {
          this.logger.info('rewind buffer loaded, allow listener connections to start');
          this.emit(StreamEvent.REWIND_LOADED);
        });
      })
      .catch((error: Err) => {
        this.logger.error(`could not load rewind from master, error: ${error.code}`, {
          error
        });
        this.emit(StreamEvent.REWIND_LOADED);
      })
  }

  listen(listener: IListener): Promise<ISource> {
    return new Promise((resolve, reject) => {
      // don't ask for a rewinder while our source is going through init,
      // since we don't want to fail an offset request that should be valid
      this.runOrWait(StreamEvent.REWIND_LOADED, async () => {
        this.stats.connections++;

        this.listenersCol.add(listener.id, listener);
        this.logger.debug(`add listener #${listener.id}, create source`);

        listener.once('disconnect', () => {
          this.logger.debug(`remove listener #${listener.id}`);
          this.listenersCol.remove(listener.id);
        });

        try {
          const source = await createListenerSource({
            listener,
            preroller: this.preroller,
            rewindBuffer: this.rewindBuffer,
          });

          this.logger.debug(`built audio source for listener #${listener.id}`);

          resolve(source);
        } catch (error) {
          this.logger.error(`error ocurred while loading rewinder for listener #${listener.id}`, {
            error,
          });
          reject(error);
        }
      });
    });
  }

  status(): StreamStatus {
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
