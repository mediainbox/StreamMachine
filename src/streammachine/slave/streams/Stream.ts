import {StreamConfig, StreamVitals, StreamStats, ListenEvent, StreamStatus} from "../types";
import {StreamMetadata} from "../types";
import { Readable } from "stream";
import {DEFAULT_AD_IMPRESSION_DELAY, DEFAULT_AD_REQUEST_TIMEOUT} from "../consts";
import { ListenersCollection } from "../listeners/ListenersCollection";
import {Chunk, Err} from "../../../types";
const { Preroller } = require('../preroll/Preroller');
const { Events, BetterEventEmitter } = require('../../events');
const _ = require("lodash");
const RewindBuffer = require("../../rewind/rewind_buffer");
const {createRewindLoader} = require("../../rewind/loader");
const ListenersCleaner = require("../listeners/cleaner");
const Listeners = require("../listeners/ListenersCollection");
const {PassThrough} = require('stream');
const {toTime} = require('../../../helpers/datetime');
const MultiStream = require('multistream');


const StreamEvents = {
  REWIND_LOADED: "REWIND_LOADED",
  CONFIG: "CONFIG",
  DISCONNECT: "DISCONNECT"
};

/**
 * Stream is the componenent where that listeners connect to.
 * Loads data from rewind buffer and pushes them to clients
 */
export class Stream extends BetterEventEmitter {
  static Events = StreamEvents;

  private readonly id: string
  private readonly config: StreamConfig;
  private readonly metadata: StreamMetadata;
  private readonly stats: StreamStats = {
    connections: 0, // total counter, not active count
    kbytesSent: 0,
  };
  private readonly listeners = new ListenersCollection();
  private vitals: Partial<StreamVitals>;

  constructor({ key, config, masterConnection, ctx }: any) {
    super();

    // remove max listener limit
    this.setMaxListeners(0);

    this.masterConnection = masterConnection;
    this.ctx = ctx;
    this.logger = ctx.logger.child({
      component: `stream[${key}]`
    })

    this.id = key;
    this.config = {
      // convert master config format
      initialBurst: config.burst,
      maxSeconds: config.seconds,
      maxBufferSize: config.max_buffer,

      // ads config
      preroll: {
        streamId: this.id,
        streamKey: '', // completed by vitals
        prerollKey: config.preroll_key || this.id,
        timeout: DEFAULT_AD_REQUEST_TIMEOUT, // TODO: fixme
        adUrl: config.preroll,
        transcoderUrl: config.transcoder,
        impressionDelay: config.impression_delay || DEFAULT_AD_IMPRESSION_DELAY,
      }
    };

    this.metadata = {
      title: config.metaTitle,
      url: config.metaUrl,
    };

    this.vitals = {
      format: config.format,
      codec: config.codec,
    };

    this.listenersCleaner = new ListenersCleaner({
      listeners: this.listeners,
      ctx,
      key,
      maxBufferSize: this.config.maxBufferSize
    })

    this.hookEvents();
    this.configure();
  }

  getId() {
    return this.id;
  }

  hookEvents() {
    // wait for rewind to be loaded before pushing any data
    this.runOrWait(StreamEvents.REWIND_LOADED, () => {
      this.ctx.events.on(`audio:${this.id}`, (chunk: Chunk) => {
        this.logger.silly(`push received audio chunk ${toTime(chunk.ts)}`);
        this.rewindBuffer.push(chunk);
      });
    });

    this.ctx.events.on(Events.Listener.LISTEN, (data: ListenEvent) => {
      if (data.streamKey !== this.id) {
        return;
      }

      this.stats.kbytesSent += data.kbytesSent;
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

      this.logger.info('received vitals from master', { vitals });
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
    if (!this.config.preroll.adUrl) {
      this.logger.warn('no preroll url configured, skipping ads config');
      return;
    }

    this.logger.info('init preroller', { config: this.config.preroll });

    this.preroller = new Preroller(
      this.id,
      this.config.preroll,
      this.logger.child({
        component: `stream[${this.id}]:preroller`
      }),
    );
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
    this.masterConnection.getRewind(this.id, (err: Err | null, res: Readable) => {
      if (err) {
        this.logger.error(`could not load rewind from master, error: ${err.code}`, {
          err
        });
        this.emit(StreamEvents.REWIND_LOADED);
        return;
      }

      this.rewindBuffer.preload(createRewindLoader(res), () => {
        this.logger.info('rewind buffer loaded, allow listener connections to start');
        this.emit(StreamEvents.REWIND_LOADED);
      });
    });
  }

  listen({ listener, opts }: any, cb: any) {
    // don't ask for a rewinder while our source is going through init,
    // since we don't want to fail an offset request that should be valid
    this.runOrWait(StreamEvents.REWIND_LOADED, () => {
      const listenerId = this.stats.connections++;

      listener.setId(listenerId);
      this.listeners.add(listener.id, listener);
      this.logger.debug(`new listener #${listener.id} for stream, assign rewinder`);

      const adOperator = this.preroller.getAdOperator(listener);

      listener.once('disconnect', () => {
        this.logger.debug(`listener #${listener.id} disconnected, remove from list`);
        this.listeners.remove(listener.id);
        adOperator.abort();
      });

      Promise.all([
        adOperator.build(),
        this.rewindBuffer.getRewinder(listener.id, opts)
      ])
        .then(([preroll, rewinder]) => {
          this.logger.debug(`got preroll and rewinder for listener #${listener.id}`);

          const output = new MultiStream([
            preroll,
            rewinder,
          ]);

          cb(null, output);
      })
        .catch(err => {
          this.logger.error(`error ocurred while loading rewinder for listener #${listener.id}`, {
            err,
            opts,
          });
          cb(err);
        });
    });
  }

  status(): StreamStatus {
    return {
      key: this.id,
      bufferStatus: this.rewindBuffer.getStatus(),
      stats: {
        listeners: this.listeners.count(),
        connections: this.stats.connections,
        kbytesSent: this.stats.kbytesSent
      }
    };
  }

  disconnect() {
    this.listeners.disconnectAll();
    this.rewindBuffer.disconnect();
    this.listenersCleaner.disconnect();

    this.emit(StreamEvents.DISCONNECT);
    this.removeAllListeners();
  }
}
