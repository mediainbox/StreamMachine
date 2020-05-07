_       = require "underscore"
uuid    = require "node-uuid"
URL     = require "url"

RewindBuffer              = require '../../rewind_buffer'
ProxySource         = require '../../sources/url_source'

module.exports = class Stream extends require('events').EventEmitter
    DefaultOptions:
        meta_interval:      32768
        max_buffer:         4194304 # 4 megabits (64 seconds of 64k audio)
        key:                null
        seconds:            (60*60*4) # 4 hours
        burst:              30
        source_password:    null
        host:               null
        fallback:           null
        acceptSourceMeta:   false
        log_minutes:        true
        monitored:          false
        metaTitle:          ""
        metaUrl:            ""
        format:             "mp3"
        preroll:            ""
        preroll_key:        ""
        transcoder:         ""
        root_route:         false
        group:              null
        bandwidth:          0
        codec:              null
        ffmpeg_args:        null
        stream_key:         null
        impression_delay:   5000
        log_interval:       30000
        geolock:            null

    constructor: (@ctx, args)->
        super()

        { @key, @mount, config } = args

        @logger = @ctx.logger.child({
            component: "stream:#{@key}"
        })
        @config = _.defaults config || {}, @DefaultOptions

        # We have three options for what source we're going to use:
        # a) Internal: Create our own source mount and manage our own sources.
        #    Basically the original stream behavior.
        # b) Source Mount: Connect to a source mount and use its source
        #    directly. You'll get whatever incoming format the source gets.
        # c) Source Mount w/ Transcoding: Connect to a source mount, but run a
        #    transcoding source between it and us, so that we always get a
        #    certain format as our input.

        @destroying = false
        @source = null

        if @config.ffmpeg_args
            # Source Mount w/ transcoding
            @_initTranscodingSource()

        else
            # Source Mount directly
            @source = @mount

        # Cache the last stream vitals we've seen
        @_vitals = null

        @emitDuration = 0

        @STATUS = "Initializing"

        @logger.info
            key: @key
            config: @config
            message: "initialize stream handler for #{@key}"

        # -- Initialize Master Rewinder -- #

        # set up a rewind buffer, for use in bringing new slaves up to speed
        # or to transfer to a new master when restarting
        @rewind = new RewindBuffer
            seconds:    @config.seconds
            burst:      @config.burst
            station:    @key
            key:        "master__#{@key}"
            logger:        @logger.child(module:"rewind")

        # Rewind listens to us, not to our source
        @rewind.emit "source", @

        # Pass along buffer loads
        @rewind.on "buffer", (c) => @emit "buffer", c

        # -- Set up data functions -- #

        @_meta =
            StreamTitle:    @config.metaTitle
            StreamUrl:      ""

        @sourceMetaFunc = (meta) =>
            if @config.acceptSourceMeta
                @setMetadata meta

        @dataFunc = (data) =>
            # inject our metadata into the data object
            @emit "data", _.extend {}, data, meta:@_meta

        @vitalsFunc = (vitals) =>
            @_vitals = vitals
            @emit "vitals", vitals

        @source.on "data", @dataFunc
        @source.on "vitals", @vitalsFunc

        # -- Hardcoded Source -- #

        # This is an initial source like a proxy that should be connected from
        # our end, rather than waiting for an incoming connection

        if @config.fallback?
            # what type of a fallback is this?
            uri = URL.parse @config.fallback

            newsource = switch uri.protocol
                when "file:"
                    new FileSource
                        key:        @key
                        format:     @config.format
                        filePath:   uri.path
                        logger:     @logger

                when "http:", "https:"
                    new ProxySource
                        key:        @key
                        format:     @config.format
                        url:        @config.fallback
                        headers:    @config.headers
                        fallback:   true
                        logger:     @logger

                else
                    null

            if newsource
                newsource.once "connect", =>
                    @addSource newsource, (err) =>
                        if err
                            @logger.error "Connection to fallback source failed."
                        else
                            @logger.debug "Fallback source connected."

                newsource.on "error", (err) =>
                    @logger.error "Fallback source error: #{err}", error:err

            else
                @logger.error "Unable to determine fallback source type for #{@config.fallback}"

    #----------

    _initTranscodingSource: ->
        @logger.debug "Setting up transcoding source for #{ @key }"

        # -- create a transcoding source -- #

        tsource = new TranscodingSource
            stream:         @mount
            ffmpeg_args:    @config.ffmpeg_args
            format:         @config.format
            logger:         @logger

        @source = tsource

        # if our transcoder goes down, restart it
        tsource.once "disconnect", =>
            @logger.error "Transcoder disconnected for #{ @key }."
            process.nextTick (=> @_initTranscodingSource()) if !@destroying

    #----------

    addSource: (source,cb) ->
        @source.addSource source, cb

    #----------

    # Return our configuration

    getConfig: ->
        @config

    #----------

    vitals: (cb) ->
        _vFunc = (v) =>
            cb? null, v

        if @_vitals
            _vFunc @_vitals
        else
            @once "vitals", _vFunc

    #----------

    getStreamKey: (cb) ->
        if @_vitals
            cb? @_vitals.streamKey
        else
            @once "vitals", => cb? @_vitals.streamKey

    #----------

    status: ->
        # id is DEPRECATED in favor of key
        key:        @key
        id:         @key
        vitals:     @_vitals
        source:     @source.status()
        rewind:     @rewind._rStatus()

    #----------

    setMetadata: (opts,cb) ->
        if opts.StreamTitle? || opts.title?
            @_meta.StreamTitle = opts.StreamTitle||opts.title

        if opts.StreamUrl? || opts.url?
            @_meta.StreamUrl = opts.StreamUrl||opts.url

        @emit "meta", @_meta

        cb? null, @_meta

    #----------

    configure: (new_opts,cb) ->
        # allow updates, but only to keys that are present in @DefaultOptions.
        for k,v of @DefaultOptions
            @config[k] = new_opts[k] if new_opts[k]?

            # convert to a number if necessary
            @config[k] = Number(@config[k]) if _.isNumber(@DefaultOptions[k])

        if @key != @config.key
            @key = @config.key

        # did they update the metaTitle?
        if new_opts.metaTitle
            @setMetadata title:new_opts.metaTitle

        # Update our rewind settings
        @rewind.setRewind @config.seconds, @config.burst

        @emit "config"

        cb? null, @config()

    #----------

    getRewind: (cb) ->
        @rewind.dumpBuffer (err,writer) =>
            cb? null, writer

    #----------

    destroy: ->
        # shut down our sources and go away
        @destroying = true

        @source.disconnect() if @source instanceof TranscodingSource
        @rewind.disconnect()

        @source.removeListener "data", @dataFunc
        @source.removeListener "vitals", @vitalsFunc

        @dataFunc = @vitalsFunc = @sourceMetaFunc = ->

        @emit "destroy"
        true

    #----------
