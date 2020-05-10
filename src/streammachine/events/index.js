var EventEmitter, Events;

({EventEmitter} = require("events"));

Events = {
  Master: {
    CONFIG_UPDATE: "config_update",
    STREAMS_UPDATE: "streams",
    NEW_SOURCE_MOUNT: "new_source_mount",
    NEW_STREAM: "new_stream"
  },
  Link: { // refers to master/slave interaction
    CONNECTION_VALIDATE: "CONNECTION_VALIDATE", // confirmation of connection
    CONFIG: "config", // config updated, payload = @master.config()
    AUDIO: "audio", // new audio chunk, payload = { stream: key, chunk: {data: Buffer, ts: number} }
    STREAM_VITALS: "STREAM_VITALS", // vitals are required stream props { streamKey, framesPerSec, emitDuration }
    SLAVE_STATUS: "status",
  },
  Slave: {
    CONNECT_ERROR: 'CONNECT_ERROR',
    CONNECTED: "connected",
    DISCONNECT: "disconnect",
    STREAMS_UPDATE_OK: "streams",
  },
  Listener: {
    LANDED: "LANDED",
    SESSION_START: "session_start",
    LISTEN: "listen",
    DISCONNECT: "DISCONNECT",
  },
};

function passthrough(_events, source, target) {
  const events = Array.isArray(_events) ? _events : [_events];

  events.forEach(event => {
    source.on(event, (...args) => target.emit(event, ...args));
  });
}

module.exports = {
  EventsHub: EventEmitter,
  Events: Events,
  BetterEventEmitter: require('./better_event_emitter'),
  passthrough
};
