const socketIO = require("socket.io-client");
const {Events} = require('../../events');
const async = require('async');
const http = require('http');

const REWIND_REQUEST_TIMEOUT = 15 * 1000;


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
    this.ws = null;
    this.id = null;
    this.attempts = 1;
    this.masterUrlIndex = 0;

    this.hookAnalyticsEvents();
    this.connect();
  }

  hookAnalyticsEvents() {
    this.ctx.events.on(Events.Listener.SESSION_START, data => {
      // serialize event to go through ws
      this.ws.emit(Events.Listener.SESSION_START, {
        stream: data.stream.key,
        listener: {
          connectedAt: data.listener.connectedAt,
          client: data.listener.client,
        }
      });
    });

    this.ctx.events.on(Events.Listener.LISTEN, data => {
      // serialize event to go through ws
      this.ws.emit(Events.Listener.LISTEN, data);
    });
  }

  getStreamVitals(key, cb) {
    this.ws.emit(Events.Link.STREAM_VITALS, key, cb);
  }

  connect() {
    const masterWsUrl = this.config.master[this.masterUrlIndex];

    this.logger.debug(`connect to master at ${masterWsUrl}`);

    this.ws = socketIO.connect(masterWsUrl, {
      reconnection: true,
      reconnectionAttempts: 3,
      timeout: this.config.timeout,
    });

    const onConnectError = (err) => {
      this.logger.warn(`connect attempt to master[${this.masterUrlIndex}] failed: ${err.message} (${err.description})`)
      this.attempts++;
    };

    this.ws.on("connect_error", onConnectError);

    this.ws.on("connect", () => {
      this.logger.info(`connection to master[${this.masterUrlIndex}] started`);

      // TODO: verify this
      // make sure our connection is valid with a ping
      const pingTimeout = setTimeout(() => {
        this.logger.warn("failed to get master OK ping response");
        this.tryFallbackConnection();
      }, 1000);

      return this.ws.emit(Events.Link.CONNECTION_VALIDATE, (res) => {
        clearTimeout(pingTimeout);

        if (res !== 'OK') {
          this.logger.warn(`invalid master OK ping response (got ${res})`);
          this.tryFallbackConnection();
          return;
        }

        this.ws.off('connect_error', onConnectError);
        this.logger.info("connection to master validated, slave is connected");
        this.id = this.ws.io.engine.id;
        this.connected = true;

        this.ctx.events.emit(Events.Slave.CONNECTED);
      });
    });

    this.ws.on("disconnect", () => {
      this.connected = false;
      this.logger.debug("disconnected from master");

      this.masterUrlIndex = -1; // FIXME
      this.tryFallbackConnection();

      return this.ctx.events.emit(Events.Slave.DISCONNECT);
    });

    this.ws.on(Events.Link.CONFIG, (config) => {
      this.ctx.events.emit(Events.Link.CONFIG, config);
    });

    this.ws.on(Events.Link.SLAVE_STATUS, (cb) => {
      this.ctx.events.emit(Events.Link.SLAVE_STATUS);
    });

    this.ws.on(Events.Link.AUDIO, (obj) => {
      // our data gets converted into an ArrayBuffer to go over the
      // socket. convert it back before insertion
      // convert timestamp back to a date object
      this.logger.silly(`audio chunk received from master: ${obj.stream}/${obj.chunk.ts.substr(11)}`)
      obj.chunk.data = Buffer.from(obj.chunk.data);
      obj.chunk.ts = new Date(obj.chunk.ts);

      // emit globally, this event will be listened by stream sources
      return this.ctx.events.emit(`audio:${obj.stream}`, obj.chunk);
    });

    this.ws.on("reconnect_failed", () => {
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

  getRewind(key, cb) {
    this.logger.info(`make rewind buffer request for stream ${key}`);

    const wrapped = async.timeout(_cb => {
      http.request({
        hostname: this.ws.io.opts.hostname,
        port: this.ws.io.opts.port,
        path: `/s/${key}/rewind`,
        headers: {
          'stream-slave-id': this.id
        }
      }, (res) => {
        this.logger.info(`got rewind response with status ${res.statusCode}`);

        if (res.statusCode !== 200) {
          _cb(new Error("rewind request got a non 200 response"));
          return;
        }

        _cb(null, res);
      })
        .on("error", _cb)
        .end();
    }, REWIND_REQUEST_TIMEOUT);

    wrapped(cb);
  }

  disconnect() {
    if (!this.ws) {
      return;
    }

    this.ws.disconnect();
  }
};
