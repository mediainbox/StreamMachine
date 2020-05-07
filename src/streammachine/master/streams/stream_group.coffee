module.exports = class StreamGroup extends require("events").EventEmitter
    constructor: (@key,@logger) ->
        super()

        @streams        = {}
        @transcoders    = {}
        @hls_min_id     = null

#----------

    addStream: (stream) ->
        if !@streams[ stream.key ]
            @logger.debug "SG #{@key}: Adding stream #{stream.key}"

            @streams[ stream.key ] = stream

            # listen in case it goes away
            delFunc = =>
                @logger.debug "SG #{@key}: Stream disconnected: #{ stream.key }"
                delete @streams[ stream.key ]

            stream.on "disconnect", delFunc

            stream.on "config", =>
                delFunc() if stream.opts.group != @key

            # if HLS is enabled, sync the stream to the rest of the group
            stream.rewind.hls_segmenter?.syncToGroup @

#----------

    status: ->
        sstatus = {}
        sstatus[k] = s.status() for k,s of @streams

        id:         @key
        streams:    sstatus

#----------
