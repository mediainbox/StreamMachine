uuid = require "uuid"
nconf = require "nconf"

FrameChunker = require "./_frame_chunker"
Debounce = require "../../util/debounce"

module.exports = class BaseSource extends require("events").EventEmitter

    #----------

    constructor: (@opts, source_opts={}) ->
        super()

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
            @parserConstructor = require "../../parsers/#{@opts.format}"

    #----------
    
    createParser: ->
        @log?.debug "create frames parser for format #{@opts.format}"

        # -- Turns data frames into chunks -- #
        @chunker = new FrameChunker @emitDuration * 1000
        
        @parser = new @parserConstructor

        # -- Pull vitals from first header -- #
        @parser.once "header", (header) =>
            # -- compute frames per second and stream key -- #
            @framesPerSec   = header.frames_per_sec
            @streamKey      = header.stream_key

            @log?.debug "setting framesPerSec to ", frames:@framesPerSec
            @log?.debug "first header received", header

            # -- send out our stream vitals -- #

            @_setVitals
                streamKey:          @streamKey
                framesPerSec:       @framesPerSec
                emitDuration:       @emitDuration

        @parser.on "frame", (frame,header) =>
            @_pingData?.ping() # heartbeat?
            @chunker.write frame:frame, header:header

        @chunker.on "readable", =>
            while chunk = @chunker.read()
                @emit "_chunk", chunk

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

    #----------

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
        @chunker?.removeAllListeners()
        @parser?.removeAllListeners()
        @_pingData?.kill()

    #----------

