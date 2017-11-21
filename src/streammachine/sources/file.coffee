fs = require "fs"
_ = require "underscore"

# FileSource emulates a stream source by reading a local audio file in a
# loop at the correct audio speed.

module.exports = class FileSource extends require("./base")
    TYPE: -> "File (#{@opts.filePath})"

    constructor: (@opts) ->
        super()

        @connected = false

        @_file = null

        @_chunks = []

        @_emit_pos  = 0
        @_last_ts   = Number(@opts.ts) || null

        @start() if !@opts.do_not_emit

        @on "_chunk", (chunk) =>
            @_chunks.push chunk

        @createParser()

        @parser.once "header", (header) =>
            @connected = true
            @emit "connect"

        @parser.once "end", =>
            # done parsing...
            @parser.removeAllListeners()
            @_current_chunk = null
            @emit "_loaded"

        # pipe our file into the parser
        @_file = fs.createReadStream @opts.filePath
        @_file.pipe(@parser)

    #----------

    start: ->
        return true if @_int

        @_int = setInterval =>
            @_emitOnce()
        , @emitDuration * 1000

        @_emitOnce()

        true

    #----------

    stop: ->
        return true if !@_int

        clearInterval @_int
        @_int = null

        true

    #----------

    # emit a certain length of time. useful for filling a buffer
    emitSeconds: (secs,wait,cb) ->
        if _.isFunction(wait)
            cb = wait
            wait = null

        emits = Math.ceil(secs / @emitDuration)
        count = 0

        if wait
            _f = =>
                @_emitOnce()
                count += 1

                if count < emits
                    setTimeout _f, wait
                else
                    cb()

            _f()
        else
            _f = =>
                @_emitOnce()
                count += 1

                if count < emits
                    process.nextTick => _f()
                else
                    cb()

            _f()

    #----------

    _emitOnce: (ts=null) ->
        @_emit_pos = 0 if @_emit_pos >= @_chunks.length

        chunk = @_chunks[ @_emit_pos ]

        return if !chunk

        console.log "NO DATA!!!! ", chunk if !chunk.data

        ts = if @_last_ts then @_last_ts + chunk.duration else Number(new Date())

        @emit "data",
            data:       chunk.data
            ts:         new Date(ts)
            duration:   chunk.duration
            streamKey:  @streamKey
            uuid:       @uuid

        @_last_ts   = ts
        @_emit_pos  = @_emit_pos + 1

    #----------

    status: ->
        source:     @TYPE?() ? @TYPE
        uuid:       @uuid
        filePath:   @filePath

    #----------

    disconnect: ->
        if @connected
            @connected = false
            @emit "disconnect"
            clearInterval @_int
