{ EventEmitter } = require("events")

Events =
  Master:
    CONFIG_UPDATE: "config_update"
    STREAMS_UPDATE: "streams"
    NEW_SOURCE_MOUNT: "new_source_mount"
    NEW_STREAM: "new_stream"


  IO: # refers to master/slave interaction
    CONNECTION_OK: "connection_ok" # confirmation of connection
    CONFIG: "config" # config updated, payload = @master.config()
    AUDIO:  "audio"  # new audio chunk, payload = { stream: key, chunk: {data: Buffer, ts: number} }
    SLAVE_VITALS: "vitals"
    SLAVE_STATUS: "status"


module.exports =
  EventsHub: EventEmitter
  Events: Events
