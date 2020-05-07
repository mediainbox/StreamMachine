var EventEmitter, EventTypes;

({EventEmitter} = require("events"));

EventTypes = {
  Master: {
    STREAMS_UPDATE: "streams",
    CONFIG_UPDATE: "config_update",
    NEW_SOURCE_MOUNT: "new_source_mount",
    NEW_STREAM: "new_stream"
  }
};

module.exports = {
  EventsHub: EventEmitter,
  EventTypes: EventTypes
};

//# sourceMappingURL=events.js.map
