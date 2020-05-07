_       = require "underscore"
uuid    = require "node-uuid"


Preroller   = require "./ads/preroller"
RewindBuffer      = require "../../rewind_buffer"

debug = require("debug")("sm:slave:stream")

# Stream is the componenent where that listeners connect to.
# Loads data from rewind buffer and pushes them to clients

module.exports = class Stream extends RewindBuffer
    constructor: (@core,key,log,opts) ->
        # initialize RewindBuffer
        super seconds: opts.seconds, burst:opts.burst, logger: log, station: key
        @log = log
        @key = key
        @opts = opts

        @STATUS = "Initializing"

        @StreamTitle  = @opts.metaTitle
        @StreamUrl    = ""

        # remove our max listener count
        @setMaxListeners 0

        @_id_increment = 1
        @_lmeta = {}

        @preroll = null
        @mlog_timer = null

        # -- Stats Counters -- #

        @_totalConnections  = 0
        @_totalKBytesSent   = 0

        @metaFunc = (chunk) =>
            @StreamTitle    = chunk.StreamTitle if chunk.StreamTitle
            @StreamUrl      = chunk.StreamUrl if chunk.StreamUrl

        @bufferFunc = (c) =>
            @_insertBuffer(c)

        @once "source", =>
            @source.on "meta", @metaFunc
            @source.on "buffer", @bufferFunc

        # now run configure...
        process.nextTick => @configure(@opts)


        # -- Wait to Load Rewind Buffer -- #

        @emit "_source_waiting"

        @_sourceInitializing = true
        @_sourceInitT = setTimeout =>
            @_sourceInitializing = false
            @emit "_source_init"
            debug "Sending _source_init after source timeout"
        , 15*1000

        @once "source", (source) =>
            debug "Stream source is incoming."
            clearTimeout @_sourceInitT
            @_sourceInitializing = true
            source.getRewind (err,stream,req) =>
                if err
                    @log.error "Source getRewind encountered an error: #{err}", error:err
                    @_sourceInitializing = false
                    @emit "_source_init"
                    debug "Sending _source_init after load error"
                    #@emit "rewind_loaded"

                    return false

                @loadBuffer stream, (err) =>
                    @log.debug "Slave source loaded rewind buffer."
                    #req.end()

                    @_sourceInitializing = false
                    @emit "_source_init"
                    debug "Sending _source_init after load success"
                    #@emit "rewind_loaded"

    #----------

    status: ->
        _.extend @_rStatus(),
            key:            @key
            listeners:      @listeners()
            connections:    @_totalConnections
            kbytes_sent:    @_totalKBytesSent

    #----------

    useSource: (source) ->
        # short-circuit if this is already our source
        return true if @source == source
        
        @log.debug "Slave stream got source connection"
        @source = source
        @emit "source", @source

    #----------

    getStreamKey: (cb) ->
        # use manual stream key if provided as part of stream configuration,
        # to allow for AAC stream keys that can't be pulled out of a header
        if @opts.stream_key
            cb @opts.stream_key
        else
            if @source
                @source.getStreamKey cb
            else
                @once "source", =>
                    @source.getStreamKey cb

    #----------

    _once_source_loaded: (cb) ->
        if @_sourceInitializing
            # wait for a source_init event
            debug "_once_source_loaded is waiting for _source_init"
            @once "_source_init", => cb?()

        else
            # send them on through
            cb?()

    #----------

    configure: (@opts) ->

        # -- Preroll -- #

        @log.debug "Preroll settings are ", preroll:@opts.preroll

        if @opts.preroll? && @opts.preroll != ""
            # create a Preroller connection
            key = if (@opts.preroll_key && @opts.preroll_key != "") then @opts.preroll_key else @key

            new Preroller @, key, @opts.preroll, @opts.transcoder, @opts.impression_delay, (err,pre) =>
                if err
                    @log.error "Failed to create preroller: #{err}"
                    return false

                @preroll = pre
                @log.debug "Preroller is created."

        # -- Set up bufferSize poller -- #

        # We disconnect clients that have fallen too far behind on their
        # buffers. Buffer size can be configured via the "max_buffer" setting,
        # which takes bits
        @log.debug "Stream's max buffer size is #{ @opts.max_buffer }"

        if @buf_timer
            clearInterval @buf_timer
            @buf_timer = null

        @buf_timer = setInterval =>
            all_buf = 0
            for id,l of @_lmeta
                all_buf += l.rewind._queuedBytes + l.obj.socket?.bufferSize

                if (l.rewind._queuedBytes||0) + (l.obj.socket?.bufferSize||0) > @opts.max_buffer
                    @log.debug "Connection exceeded max buffer size.", client:l.obj.client, bufferSize:l.rewind._queuedBytes
                    l.obj.disconnect(true)

            @log.debug "All buffers: #{all_buf}"
        , 60*1000

        # Update RewindBuffer settings
        @setRewind @opts.seconds, @opts.burst

        @emit "config"

    #----------

    disconnect: ->
        # handle clearing out lmeta
        l.obj.disconnect(true) for k,l of @_lmeta

        if @buf_timer
            clearInterval @buf_timer
            @buf_timer = null

        @source?.removeListener "meta", @metaFunc
        @source?.removeListener "buffer", @bufferFunc
        @source = null

        @metaFunc = @bufferFunc = ->

        super()

        @emit "disconnect"

        @removeAllListeners()

    #----------

    listeners: ->
        _(@_lmeta).keys().length

    #----------

    listen: (obj,opts,cb) ->
        # generate a metadata hash
        lmeta =
            id:         @_id_increment++
            obj:        obj
            startTime:  opts.startTime  || (new Date)

        # each listen is a connection
        @_totalConnections += 1

        # inject stream config into our options
        opts = _.extend { logInterval: @opts.log_interval }, opts

        # don't ask for a rewinder while our source is going through init,
        # since we don't want to fail an offset request that should be
        # valid.
        @_once_source_loaded =>
            # get a rewinder (handles the actual broadcast)
            @getRewinder lmeta.id, opts, (err,rewind,extra...) =>
                if err
                    cb? err, null
                    return false

                lmeta.rewind = rewind

                # stash the object
                @_lmeta[ lmeta.id ] = lmeta

                # return the rewinder (so that they can change offsets, etc)
                cb? null, lmeta.rewind, extra...

    #----------

    disconnectListener: (id) ->
        if lmeta = @_lmeta[id]
            # -- remove from listeners -- #
            delete @_lmeta[id]

            true
        else
            console.error "disconnectListener called for #{id}, but no listener found."

    #----------

    # Log a partial listening segment
    recordListen: (opts) ->
        # temporary conversion support...
        opts.kbytes = Math.floor( opts.bytes / 1024 ) if opts.bytes

        @_totalKBytesSent += opts.kbytes if _.isNumber(opts.kbytes)

        if lmeta = @_lmeta[opts.id]
            nothing = 1
            ###
            @log.interaction "",
                type:           "listen"
                client:         lmeta.obj.client
                time:           new Date()
                kbytes:         opts.kbytes
                duration:       opts.seconds
                offsetSeconds:  opts.offsetSeconds
                contentTime:    opts.contentTime
            ###

    #----------

    startSession: (client,cb) ->
        ###
        @log.interaction "",
            type:       "session_start"
            client:     client
            time:       new Date()
            session_id: client.session_id
        ###

        cb null, client.session_id

    #----------
