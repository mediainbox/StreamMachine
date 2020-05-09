const socketIO = require("socket.io-client");
const {Events} = require('../../events');

/**
 * This is the component that connects to Master
 */

module.exports = class MasterConnection extends require("events").EventEmitter {
  constructor(ctx) {
    super();

    this.ctx = ctx;
    this.logger = this.ctx.logger.child({
      component: 'master-connection'
    });
    this.config = this.ctx.config.slave;

    this.connected = false;
    this.io = null;
    this.id = null;
    this.attempts = 1;
    this.masterUrlIndex = 0;

    this.hookAnalyticsEvents();
    this.connect();
  }

  hookAnalyticsEvents() {
    this.ctx.events.on(Events.Listener.LISTEN, data => {
      this.io.emit(Events.Listener.LISTEN, data);
    });

    this.ctx.events.on(Events.Listener.SESSION_START, data => {
      this.io.emit(Events.Listener.SESSION_START, data);
    });
  }

  getStreamVitals(key, cb) {
    this.io.emit(Events.Link.STREAM_VITALS, key, cb);
  }

  connect() {
    const masterWsUrl = this.config.master[this.masterUrlIndex];

    this.logger.debug(`connect to master at ${masterWsUrl}`);

    this.io = socketIO.connect(masterWsUrl, {
      reconnection: true,
      reconnectionAttempts: 3,
      timeout: this.config.timeout,
    });

    const onConnectError = (err) => {
      this.logger.warn(`connect attempt to master[${this.masterUrlIndex}] failed: ${err.message} (${err.description})`)
      this.attempts++;
    };

    this.io.on("connect_error", onConnectError);

    this.io.on("connect", () => {
      this.logger.debug(`connection to master[${this.masterUrlIndex}] started`);

      // TODO: verify this
      // make sure our connection is valid with a ping
      const pingTimeout = setTimeout(() => {
        this.logger.warn("failed to get master OK ping response");
        this.tryFallbackConnection();
      }, 1000);

      return this.io.emit(Events.Link.CONNECTION_VALIDATE, (res) => {
        clearTimeout(pingTimeout);

        if (res !== 'OK') {
          this.logger.warn(`invalid master OK ping response (got ${res})`);
          this.tryFallbackConnection();
          return;
        }

        this.io.off('connect_error', onConnectError);
        this.logger.debug("connection to master validated, slave is connected");
        this.id = this.io.io.engine.id;
        this.connected = true;

        this.ctx.events.emit(Events.Slave.CONNECTED);
      });
    });

    this.io.on("disconnect", () => {
      this.connected = false;
      this.logger.debug("disconnected from master");

      this.masterUrlIndex = -1; // FIXME
      this.tryFallbackConnection();

      return this.ctx.events.emit(Events.Slave.DISCONNECT);
    });

    this.io.on(Events.Link.CONFIG, (config) => {
      this.ctx.events.emit(Events.Link.CONFIG, config);
    });

    this.io.on(Events.Link.SLAVE_STATUS, (cb) => {
      this.ctx.events.emit(Events.Link.SLAVE_STATUS);
    });

    this.io.on(Events.Link.AUDIO, (obj) => {
      // our data gets converted into an ArrayBuffer to go over the
      // socket. convert it back before insertion
      // convert timestamp back to a date object
      this.logger.silly(`audio chunk received from master: ${obj.stream}/${obj.chunk.ts.substr(11)}`)
      obj.chunk.data = Buffer.from(obj.chunk.data);
      obj.chunk.ts = new Date(obj.chunk.ts);

      // emit globally, this event will be listened by stream sources
      return this.ctx.events.emit(`audio:${obj.stream}`, obj.chunk);
    });

    this.io.on("reconnect_failed", () => {
      this.tryFallbackConnection();
    });
  }

  tryFallbackConnection() {
    this.disconnect();
    const masterUrls = this.config.master;

    this.masterUrlIndex++;
    if (this.masterUrlIndex >= masterUrls.length) {
      // all master urls tried, emit error
      this.logger.error('no more available master connections to try, emit error');
      this.ctx.events.emit(Events.Slave.CONNECT_ERROR);
      return;
    }

    // else, try to connect to the next url
    this.logger.debug('try next master available url');
    this.connect();
  }

  disconnect() {
    if (!this.io) {
      return;
    }

    this.io.disconnect();
  }
};
