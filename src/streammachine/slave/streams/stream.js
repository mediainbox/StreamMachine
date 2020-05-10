const { Events, BetterEventEmitter } = require('../../events');
const _ = require("lodash");
const RewindBuffer = require("../../rewind/rewind_buffer");
const Collection = require('../../util/collection');
const ListenersCleaner = require("../listeners/cleaner");
const Listeners = require("../listeners/listeners");

const INTERNAL_EVENTS = {
  SOURCE_INIT: "SOURCE_INIT",
  CONFIG: "CONFIG"
};

/**
 * Stream is the componenent where that listeners connect to.
 * Loads data from rewind buffer and pushes them to clients
 */
module.exports = class Stream extends BetterEventEmitter {
  key = '';
  config = {};
  metadata = {
    title: null,
    url: null,
  };
  stats = {
    connections: 0,
    kbytesSent: 0,
  };
  vitals = null;
  nextListenerId = 1;

  constructor({ key, config, masterConnection, ctx }) {
    super();

    // remove our max listener count
    this.setMaxListeners(0);

    this.masterConnection = masterConnection;
    this.ctx = ctx;
    this.logger = ctx.logger.child({
      component: `stream[${key}]`
    })

    this.key = key;
    this.config = config;
    this.metadata.title = this.config.metaTitle;

    this.listeners = new Listeners();
    this.listenersCleaner = new ListenersCleaner({
      listeners: this.listeners,
      ctx,
      key,
      maxBuffer: this.config.max_buffer
    })

    this.hookEvents();
    this.configure();
  }

  hookEvents() {
    this.runOrWait(INTERNAL_EVENTS.SOURCE_INIT, () => {
      this.ctx.events.on(`audio:${this.key}`, (chunk) => {
        this.logger.silly(`push received audio chunk ${(chunk.ts.toISOString().substr(11))}`);
        this.rewindBuffer.push(chunk);
      });
    });
  }

  configure() {
    this.logger.info(`stream max buffer size is ${this.config.max_buffer}`);

    this.masterConnection.getStreamVitals(this.key, (err, vitals) => {
      this.logger.info('received vitals from master', { vitals });
      this.vitals = vitals;
      this.initRewindBuffer();
    });
  }

  initRewindBuffer() {
    // rewind buffer associated to this stream
    this.rewindBuffer = new RewindBuffer({
      seconds: this.config.seconds,
      burst: this.config.burst,
      logger: this.logger,
      station: this.key,
    });

    this.masterConnection.getRewind(this.key, (err, res) => {
      if (err) {
        this.logger.error(`could not load rewind from master, error: ${err.code}`);
        this.emit(INTERNAL_EVENTS.SOURCE_INIT);
        return;
      }

      this.rewindBuffer.loadBuffer(res, (err) => {
        if (err) {
          this.logger.error("error ocurred during buffer load", { err });
        } else {
          this.logger.info("rewind load from master done");
        }

        this.logger.info('allow listener connections to start');

        this.emit(INTERNAL_EVENTS.SOURCE_INIT);
      });
    });
  }

  listen({ listener, opts }, cb) {
    this.stats.connections++;

    listener.setId(this.nextListenerId++);
    this.listeners.add(listener.id, listener);
    this.logger.debug(`serve listener #${listener.id}`);

    listener.once('disconnect', () => {
      this.logger.debug(`listener #${listener.id} disconnected, remove from list`);
      this.listeners.remove(listener.id);
    });

    // don't ask for a rewinder while our source is going through init,
    // since we don't want to fail an offset request that should be valid
    this.runOrWait(INTERNAL_EVENTS.SOURCE_INIT, () => {
      // get a rewinder that handles the actual broadcast
      this.rewindBuffer.getRewinder(listener.id, opts, (err, rewinder) => {
        if (err) {
          cb(err);
          return;
        }

        cb(null, rewinder);
      });
    });
  }

  status() {
    return {
      ...this.rewindBuffer._rStatus(),
      key: this.key,
      listeners: this.listeners.count(),
      connections: this.stats.connections,
      kbytes_sent: this.stats.kbytesSent
    };
  }

  disconnect() {
    this.listeners.disconnectAll();
    this.rewindBuffer.disconnect();
    this.listenersCleaner.disconnect();

    //this.emit("disconnect");
    this.removeAllListeners();
  }
};
