import {
  Format, ListenEvent, ListenOptions,
  SlaveCtx,
  StreamConfig_V1,
  StreamMetadata,
  StreamStats,
  StreamStatus,
  StreamVitals
} from "../types";
import {DEFAULT_AD_IMPRESSION_DELAY, DEFAULT_AD_REQUEST_TIMEOUT} from "../consts";
import {ListenersCollection} from "../listeners/ListenersCollection";
import {Chunk, Err} from "../../types";
import {CombinedSource} from "../output/CombinedSource";
import {ListenersCleaner} from "../listeners/ListenersCleaner";
import {BetterEventEmitter, Events} from "../../events";
import {toTime} from "../../helpers/datetime";
import {Preroller} from "../preroll/Preroller";
import {MasterConnection} from "../master_io/MasterConnection";
import {PrerollerConfig} from "../preroll/types";
import {Logger} from "winston";
import {IListener} from "../listeners/IListener";
import {NullPreroller} from "../preroll/NullPreroller";
import {IPreroller} from "../preroll/IPreroller";
import {ListenersReporter} from "../listeners/ListenersReporter";
import {createListenerSource} from "./sourceFactory";
import {ISource} from "../output/ISource";

const RewindBuffer = require("../../rewind/rewind_buffer");
const {createRewindLoader} = require("../../rewind/loader");


const StreamEvents = {
  REWIND_LOADED: "REWIND_LOADED",
  CONFIG: "CONFIG",
  DISCONNECT: "DISCONNECT"
};

interface InternalConfig {
  readonly format: Format;
  readonly maxBufferSize: number;
  readonly maxSeconds: number;
  readonly initialBurst: number;
  readonly listenEventInterval: number;
  readonly preroll: PrerollerConfig;
}

/**
 * Stream is the componenent where that listeners connect to.
 * Loads data from rewind buffer and pushes them to clients
 */
export class Stream extends BetterEventEmitter {
  static Events = StreamEvents;

  private readonly config: InternalConfig;
  private readonly metadata: StreamMetadata;
  private readonly stats: StreamStats = {
    connections: 0, // total counter, not active count
    sentBytes: 0,
  };
  private readonly listenersCol = new ListenersCollection();
  private vitals: Partial<StreamVitals>;

  private readonly logger: Logger;
  private readonly listenersCleaner: ListenersCleaner;
  private readonly listenersReporter: ListenersReporter;

  private preroller: IPreroller;
  private rewindBuffer: any;

  constructor(
    private readonly id: string,
    private readonly passedConfig: StreamConfig_V1,
    private readonly masterConnection: MasterConnection,
    private readonly ctx: SlaveCtx
  ) {
    super();

    // remove max listener limit
    this.setMaxListeners(0);

    this.logger = ctx.logger.child({
      component: `stream[${id}]`
    })

    this.id = id;
    this.config = {
      // convert master config format
      format: passedConfig.format,
      initialBurst: 5, // passedConfig.burst,
      maxSeconds: passedConfig.seconds,
      maxBufferSize: passedConfig.max_buffer,
      listenEventInterval: passedConfig.log_interval,

      // ads config
      preroll: {
        enabled: !!passedConfig.preroll,
        streamId: this.id,
        streamKey: '', // completed by vitals
        prerollKey: passedConfig.preroll_key || this.id,
        timeout: DEFAULT_AD_REQUEST_TIMEOUT, // TODO: fixme
        adUrl: passedConfig.preroll,
        transcoderUrl: passedConfig.transcoder!,
        impressionDelay: passedConfig.impression_delay || DEFAULT_AD_IMPRESSION_DELAY,
      }
    };

    this.metadata = {
      title: passedConfig.metaTitle,
      url: passedConfig.metaUrl,
    };

    this.vitals = {
      format: passedConfig.format,
      codec: passedConfig.codec,
    };

    this.listenersCleaner = new ListenersCleaner(
      this.listenersCol,
      this.config.maxBufferSize,
      ctx.logger.child({
        component: `listeners_cleaner[${this.id}]`
      }),
    );

    this.listenersReporter = new ListenersReporter(
      this.listenersCol,
      ctx.logger.child({
        component: `listeners_reporter[${this.id}]`
      }),
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
    this.runOrWait(StreamEvents.REWIND_LOADED, () => {
      this.ctx.events.on(`audio:${this.id}`, (chunk: Chunk) => {
        this.logger.silly(`push received audio chunk ${toTime(chunk.ts)}`);
        this.rewindBuffer.push(chunk);
        // TODO: fixme
        this.listenersCol.pushLatest(this.rewindBuffer.buffer);
      });
    });

    this.ctx.events.on(Events.Listener.LISTEN, (data: ListenEvent) => {
      if (data.streamId !== this.id) {
        return;
      }

      this.stats.sentBytes += data.sentBytes;
    });
  }

  configure(config?: any) {
    // TODO: handle reconfiguration
    if (this.rewindBuffer) {
      return;
    }

    this.logger.info(`configure stream, max buffer size is ${this.config.maxBufferSize}`);

    // configure rewind buffer
    // get vitals from master and then initialize the buffer
    this.masterConnection.getStreamVitals(this.id, (err: Error | null, vitals: any) => {
      // TODO: handle error

      this.logger.info('received vitals from master', {vitals});
      this.vitals = {
        ...this.vitals,
        streamKey: vitals.streamKey,
        framesPerSecond: vitals.framesPerSec,
        secondsPerChunk: vitals.emitDuration,
      };

      // complete preroll config
      // TODO: improve this
      (this.config.preroll as any).streamKey = vitals.streamKey;

      this.initPreroller();
      this.initRewindBuffer();
    });

  }

  initPreroller() {
    const { enabled } = this.config.preroll;

    if (enabled) {
      this.logger.info('ads are enabled, init preroller');
    } else {
      this.logger.info('ads are disabled');
    }

    this.preroller = enabled ?
      new Preroller(
        this.id,
        this.config.preroll,
        this.logger.child({
          component: `preroller[${this.id}]`
        }),
      )
      : new NullPreroller();
  }

  initRewindBuffer() {
    // create rewind buffer associated to this stream that will
    // store the audio chunks sent from master
    this.rewindBuffer = new RewindBuffer({
      id: `slave__${this.id}`,
      streamKey: this.id,
      maxSeconds: this.config.maxSeconds,
      initialBurst: this.config.initialBurst,
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
          this.emit(StreamEvents.REWIND_LOADED);
        });
      })
      .catch((error: Err) => {
        this.logger.error(`could not load rewind from master, error: ${error.code}`, {
          error
        });
        this.emit(StreamEvents.REWIND_LOADED);
      })
  }

  listen(listener: IListener): Promise<ISource> {
    return new Promise((resolve, reject) => {
      // don't ask for a rewinder while our source is going through init,
      // since we don't want to fail an offset request that should be valid
      this.runOrWait(StreamEvents.REWIND_LOADED, async () => {
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

  disconnect() {
    this.listenersCol.disconnectAll();
    this.rewindBuffer.disconnect();
    this.listenersCleaner.destroy();

    this.emit(StreamEvents.DISCONNECT);
    this.removeAllListeners();
  }
}
