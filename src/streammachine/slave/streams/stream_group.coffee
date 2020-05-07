
class @StreamGroup extends require("events").EventEmitter
    constructor: (@key,@log) ->
        super()
        @streams    = {}

#----------

    addStream: (stream) ->
        if !@streams[ stream.key ]
            @log.debug "SG #{@key}: Adding stream #{stream.key}"

            @streams[ stream.key ] = stream

            # listen in case it goes away
            delFunc = =>
                @log.debug "SG #{@key}: Stream disconnected: #{ stream.key }"
                delete @streams[ stream.key ]

            stream.on "disconnect", delFunc

            stream.on "config", =>
                delFunc() if stream.opts.group != @key

#----------

    startSession: (client,cb) ->
        @logger.error "session_start",
            type:       "session_start"
            client:     client
            time:       new Date()
            id:         client.session_id

        cb null, client.session_id
