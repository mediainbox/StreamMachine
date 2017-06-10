uuid = require "node-uuid"
nconf = require "nconf"

Debounce = require "../util/debounce"

module.exports = class Source extends require("events").EventEmitter

    #----------

    constructor: (source_opts={}) ->
        @uuid = @opts.uuid || uuid.v4()

        @connectedAt = @opts.connectedAt || new Date()

        @_shouldHandoff = false

        @_isDisconnected = false

        @isFallback = false
        @streamKey  = null
        @_vitals    = null

        @_chunk_queue = []
        @_chunk_queue_ts = null

        # How often will we emit chunks of data? The default is set in StreamMachine.Defaults

        @emitDuration = @opts.chunkDuration || ( nconf.get("chunk_duration") && Number(nconf.get("chunk_duration")) ) || 0.5

        @log = @opts.logger?.child uuid:@uuid

        @parser = new (require "../parsers/#{@opts.format}")

        if source_opts.useHeartbeat
            # -- Alert if data stops flowing -- #

            # creates a sort of dead mans switch that we use to kill the connection
            # if it stops sending data

            @_pingData = new Debounce @opts.heartbeatTimeout || 30*1000, (last_ts) =>
                if !@_isDisconnected
                    # data has stopped flowing. kill the connection.
                    @log?.info "Source data stopped flowing.  Killing connection."
                    @emit "_source_dead", last_ts, Number(new Date())
                    @disconnect()

        if !source_opts.skipParser
            # -- Pull vitals from first header -- #

            @parser.once "header", (header) =>
                # -- compute frames per second and stream key -- #

                @framesPerSec   = header.frames_per_sec
                @streamKey      = header.stream_key

                @log?.debug "setting framesPerSec to ", frames:@framesPerSec
                @log?.debug "first header is ", header

                # -- send out our stream vitals -- #

                @_setVitals
                    streamKey:          @streamKey
                    framesPerSec:       @framesPerSec
                    emitDuration:       @emitDuration

            # -- Turn data frames into chunks -- #

            @chunker = new Source.FrameChunker @emitDuration * 1000

            @parser.on "frame", (frame,header) =>
                # heartbeat?
                #console.log "_pingData at ",Number(new Date())
                @_pingData?.ping()

                @chunker.write frame:frame, header:header

            @chunker.on "readable", =>
                while c = @chunker.read()
                    @emit "_chunk", c

    #----------

    getStreamKey: (cb) ->
        if @streamKey
            cb? @streamKey
        else
            @once "vitals", => cb? @_vitals.streamKey

    #----------

    _setVitals: (vitals) ->
        @_vitals = vitals
        @emit "vitals", @_vitals

    vitals: (cb) ->
        _vFunc = (v) =>
            cb? null, v

        if @_vitals
            _vFunc @_vitals
        else
            @once "vitals", _vFunc

    #----------

    disconnect: (cb) ->
        @log?.debug "Setting _isDisconnected"
        @_isDisconnected = true
        @chunker.removeAllListeners()
        @parser.removeAllListeners()
        @_pingData?.kill()

    #----------

    class @FrameChunker extends require("stream").Transform
        constructor: (@duration,@initialTime = new Date()) ->
            @_chunk_queue       = []
            @_queue_duration    = 0
            @_remainders        = 0

            @_target = @duration

            @_last_ts           = null

            super objectMode:true

        #----------

        resetTime: (ts) ->
            @_last_ts       = null
            @_remainders    = 0
            @initialTime    = ts

        #----------

        _transform: (obj,encoding,cb) ->
            @_chunk_queue.push obj
            @_queue_duration += obj.header.duration

            if @_queue_duration > @_target
                # reset our target for the next chunk
                @_target = @_target + (@duration - @_queue_duration)

                # what's the total data length?
                len = 0
                len += o.frame.length for o in @_chunk_queue

                # how many frames?
                frames = @_chunk_queue.length

                # make one buffer
                buf = Buffer.concat (o.frame for o in @_chunk_queue)

                duration = @_queue_duration

                # reset queue
                @_chunk_queue.length    = 0
                @_queue_duration        = 0

                # what's the timestamp for this chunk? If it seems reasonable
                # to attach it to the last chunk, let's do so.

                simple_dur = Math.floor(duration)
                @_remainders += duration - simple_dur

                if @_remainders > 1
                    simple_rem = Math.floor(@_remainders)
                    @_remainders = @_remainders - simple_rem
                    simple_dur += simple_rem

                ts =
                    if @_last_ts
                        new Date( Number(@_last_ts) + simple_dur )
                    else
                        @initialTime

                @_last_ts = ts

                @push
                    data:       buf
                    ts:         ts
                    duration:   duration
                    frames:     frames
                    streamKey:  obj.header.stream_key

            cb()
