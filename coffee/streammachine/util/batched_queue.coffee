debug = require("debug")("sm:util:batched_queue")

module.exports = class BatchedQueue extends require("stream").Transform
    constructor: (@opts={}) ->
        super objectMode:true

        @_writableState.highWaterMark = @opts.writable || 4096
        @_readableState.highWaterMark = @opts.readable || 1

        @_size      = @opts.batch   || 1000
        @_latency   = @opts.latency || 200

        debug "Setting up BatchedQueue with size of #{@_size} and max latency of #{@_latency}ms"

        @_queue = []
        @_timer = null

    _transform: (obj,encoding,cb) ->
        @_queue.push obj

        if @_queue.length >= @_size
            debug "Calling writeQueue for batch size"
            return @_writeQueue cb

        if !@_timer
            @_timer = setTimeout =>
                debug "Calling writeQueue after latency timeout"
                @_writeQueue()
            , @_latency

        cb()

    _flush: (cb) ->
        @_writeQueue cb

    _writeQueue: (cb) ->
        if @_timer
            clearTimeout @_timer
            @_timer = null

        batch = @_queue.splice(0)

        debug "Writing batch of #{batch.length} objects"

        @push batch if batch.length > 0

        cb?()