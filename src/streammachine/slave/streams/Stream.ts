const { EmptyReadable } = require('../../util/EmptyReadable');

const { Preroller } = require('../preroll/Preroller');
const { Events, BetterEventEmitter } = require('../../events');
const _ = require("lodash");
const RewindBuffer = require("../../rewind/rewind_buffer");
const {createRewindLoader} = require("../../rewind/loader");
const ListenersCleaner = require("../listeners/cleaner");
const Listeners = require("../listeners/listeners");
const {PassThrough} = require('stream');
const {toTime} = require('../../../helpers/datetime');

const StreamEvents = {
  REWIND_LOADED: "REWIND_LOADED",
  CONFIG: "CONFIG",
  DISCONNECT: "DISCONNECT"
};

/**
 * Stream is the componenent where that listeners connect to.
 * Loads data from rewind buffer and pushes them to clients
 */
module.exports = class Stream extends BetterEventEmitter {
  static Events = StreamEvents;

  key = null;
  config = {
    maxBufferSize: null,
    maxSeconds: null,
    initialBurst: null,
    preroll: {
      key: null,
      adUrl: null,
      transcoderUrl: null,
      impressionDelay: null,
    }
  };
  metadata = {
    title: null,
    url: null,
  };
  vitals = {
    format: null,
    codec: null,
    streamKey: null,
    framesPerSecond: null,
    secondsPerChunk: null,
  };
  stats = {
    connectionsCount: 0, // total counter, not active count
    kbytesSent: 0,
  }
  listeners = new Listeners();
  nextListenerId = 1;

  constructor({ key, config, masterConnection, ctx }) {
    super();

    // remove max listener limit
    this.setMaxListeners(0);

    this.masterConnection = masterConnection;
    this.ctx = ctx;
    this.logger = ctx.logger.child({
      component: `stream[${key}]`
    })

    this.key = key;
    this.config = {
      // convert master config format
      initialBurst: config.burst,
      maxSeconds: config.seconds,
      maxBufferSize: config.max_buffer,

      // ads config
      preroll: {
        adUrl: config.preroll,
        transcoderUrl: config.transcoder,
        key: config.preroll_key,
        impressionDelay: config.impression_delay,
      }
    };

    this.metadata = {
      title: config.metaTitle,
      url: config.metaUrl,
    };

    this.vitals.format = config.format;
    this.vitals.codec = config.codec;

    this.listenersCleaner = new ListenersCleaner({
      listeners: this.listeners,
      ctx,
      key,
      maxBufferSize: this.config.maxBufferSize
    })

    this.hookEvents();
    this.configure();
  }

  hookEvents() {
    // wait for rewind to be loaded before pushing any data
    this.runOrWait(StreamEvents.REWIND_LOADED, () => {
      this.ctx.events.on(`audio:${this.key}`, (chunk) => {
        this.logger.silly(`push received audio chunk ${toTime(chunk.ts)}`);
        this.rewindBuffer.push(chunk);
      });
    });

    this.ctx.events.on(Events.Listener.LISTEN, data => {
      if (data.streamKey !== this.key) {
        return;
      }

      this.stats.kbytesSent += data.kbytesSent;
    });
  }

  configure() {
    // TODO: handle reconfiguration
    if (this.rewindBuffer) {
      return;
    }

    this.logger.info(`configure stream, max buffer size is ${this.config.maxBufferSize}`);

    // configure rewind buffer
    // get vitals from master and then initialize the buffer
    this.masterConnection.getStreamVitals(this.key, (err, vitals) => {
      this.logger.info('received vitals from master', { vitals });
      this.vitals = {
        streamKey: vitals.streamKey,
        framesPerSecond: vitals.framesPerSec,
        secondsPerChunk: vitals.emitDuration,
      };

      // run ads configuration
      this.configureAds();

      // init rewinder
      this.initRewindBuffer();
    });

  }

  configureAds() {
    if (!this.config.preroll.adUrl) {
      this.logger.warn('no preroll url configured, skipping ads config');
      return;
    }

    this.logger.info('configure preroller', { config: this.config.preroll });

    this.preroller = new Preroller(
      this.key,
      {
        ...this.config.preroll,
        streamKey: this.vitals.streamKey,
      },
      this.logger.child({
        component: `stream[${this.key}]:preroller`
      }),
    );
  }

  initRewindBuffer() {
    // create rewind buffer associated to this stream that will
    // store the audio chunks sent from master
    this.rewindBuffer = new RewindBuffer({
      id: `slave__${this.key}`,
      streamKey: this.key,
      maxSeconds: this.config.maxSeconds,
      initialBurst: this.config.initialBurst,
      vitals: this.vitals,
      logger: this.logger,
    });

    // fetch current buffer from master and preload rewind
    this.masterConnection.getRewind(this.key, (err, res) => {
      if (err) {
        this.logger.error(`could not load rewind from master, error: ${err.code}`, {
          err
        });
        this.emit(StreamEvents.REWIND_LOADED);
        return;
      }

      this.rewindBuffer.preload(createRewindLoader(res), () => {
        this.logger.info('rewind loaded, allow listener connections to start');
        this.emit(StreamEvents.REWIND_LOADED);
      });
    });
  }

  listen({ listener, opts }, cb) {
    this.stats.connectionsCount++;

    listener.setId(this.nextListenerId++);
    this.listeners.add(listener.id, listener);
    this.logger.debug(`new listener #${listener.id} for stream, assign rewinder`);

    listener.once('disconnect', () => {
      this.logger.debug(`listener #${listener.id} disconnected, remove from list`);
      this.listeners.remove(listener.id);
    });

    // don't ask for a rewinder while our source is going through init,
    // since we don't want to fail an offset request that should be valid
    this.runOrWait(StreamEvents.REWIND_LOADED, () => {
      const adOperator = this.preroller.getAdOperator(listener);

      Promise.all([
        adOperator.build(),
        this.rewindBuffer.getRewinder(listener.id, opts)
      ])
        .then(([preroll, rewinder]) => {
          this.logger.debug(`got rewinder for listener #${listener.id}`);

          const output = new PassThrough();

          preroll.pipe(output, { end: false });
          preroll.on('end', () => {
            rewinder.pipe(output);
          });

          //adOperator.abort();

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

  status() {
    return {
      key: this.key,
      bufferStatus: this.rewindBuffer.getStatus(),
      stats: {
        listenersCount: this.listeners.count(),
        connectionsCount: this.stats.connectionsCount,
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
};
