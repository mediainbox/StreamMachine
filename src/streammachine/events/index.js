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
    SLAVE_VITALS: "vitals",
    SLAVE_STATUS: "status"
  },
  Slave: {
    CONNECT_ERROR: 'CONNECT_ERROR',
    CONNECTED: "connected",
    DISCONNECT: "disconnect",
    STREAMS_UPDATE_OK: "streams",
  },
  Listener: {
    SESSION_START: "session_start",
    LISTEN: "listen",
  },
};

module.exports = {
  EventsHub: EventEmitter,
  Events: Events,
  BetterEventEmitter: require('./better_event_emitter')
};
