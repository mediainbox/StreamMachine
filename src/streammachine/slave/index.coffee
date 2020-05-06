_ = require "underscore"

Stream  = require "./stream"
Server  = require "./server"
Alerts  = require "../alerts"
IO      = require "./slave_io"
SocketSource = require "./socket_source"

URL     = require "url"
HTTP    = require "http"
tz      = require 'timezone'

debug = require("debug")("sm:slave:slave")

module.exports = class Slave extends require("events").EventEmitter
    Outputs:
        pumper:         require "../outputs/pumper"
        shoutcast:      require "../outputs/shoutcast"
        raw:            require "../outputs/raw_audio"
        live_streaming: require "../outputs/live_streaming"

    constructor: (@options,@_worker) ->
        super()

        @_configured = false

        debug "Init for Slave"

        @master = null

        @streams        = {}
        @stream_groups  = {}
        @root_route     = null

        @connected      = false
        @_retrying      = null

        @_shuttingDown  = false

        # -- Global Stats -- #

        # we'll track these at the stream level and then bubble them up
        @_totalConnections  = 0
        @_totalKBytesSent   = 0

        # -- Set up logging -- #

        @log = @options.logger

        # -- create an alerts object -- #

        @alerts = new Alerts logger:@log.child(module:"alerts")

        # -- Make sure we have the proper slave config options -- #

        if @options.slave?.master
            debug "Connecting IO to master"
            @io = new IO @, @log.child(module:"slave_io"), @options.slave

            @io.on "connected", =>
                debug "IO is connected"
                @alerts.update "slave_disconnected", @io.id, false
                @log.proxyToMaster(@io)

            @io.on "disconnected", =>
                debug "IO is disconnected"
                @alerts.update "slave_disconnected", @io.id, true
                @log.proxyToMaster()

        @once "streams", =>
            debug "Streams event received"
            @_configured = true

        # -- set up our stream server -- #

        @server = new Server core:@, logger:@log.child(subcomponent:"server"), config:@options

    #----------

    once_configured: (cb) ->
        if @_configured
            cb()
        else
            @once "streams", => cb()

    once_rewinds_loaded: (cb) ->
        @once_configured =>
            @log.debug "Looking for sources to load in #{ Object.keys(@streams).length } streams."
            aFunc = _.after Object.keys(@streams).length, =>
                @log.debug "All sources are loaded."
                cb()

            # watch for each configured stream to have its rewind buffer loaded.
            obj._once_source_loaded aFunc for k,obj of @streams

    #----------

    _shutdown: (cb) ->
        if !@_worker
            cb "Don't have _worker to trigger shutdown on."
            return false

        if @_shuttingDown
            # already shutting down...
            cb "Shutdown already in progress."
            return false

        @_shuttingDown = true

        # A shutdown involves a) stopping listening for new connections and
        # b) transferring our listeners to a different slave

        # tell our server to stop listening
        @server.close()

        # tell our worker process to transfer out our listeners
        @_worker.shutdown cb

    #----------

    configureStreams: (options) ->
        debug "In configureStreams"
        @log.debug "In slave configureStreams with ", options:options

        # are any of our current streams missing from the new options? if so,
        # disconnect them
        for k,obj of @streams
            if !options?[k]
                debug "configureStreams: Disconnecting stream #{k}"
                @log.info "configureStreams: Calling disconnect on #{k}"
                obj.disconnect()
                delete @streams[k]

        # run through the streams we've been passed, initializing sources and
        # creating rewind buffers

        debug "configureStreams: New options start"
        for key,opts of options
            debug "configureStreams: Configuring #{key}"
            if @streams[key]
                # existing stream...  pass it updated configuration
                @log.debug "Passing updated config to stream: #{key}", opts:opts
                @streams[key].configure opts
            else
                @log.debug "Starting up stream: #{key}", opts:opts

                # HLS support?
                opts.hls = true if @options.hls

                # FIXME: Eventually it would make sense to allow a per-stream
                # value here
                opts.tz = tz(require "timezone/zones")(@options.timezone||"UTC")

                stream = @streams[key] = new Stream @, key, @log.child(stream:key), opts

                if @io
                    source = @socketSource stream
                    stream.useSource source

            # part of a stream group?
            if g = @streams[key].opts.group
                # do we have a matching group?
                sg = ( @stream_groups[ g ] ||= new Stream.StreamGroup g, @log.child stream_group:g )
                sg.addStream @streams[key]

                #@streams[key].hls_segmenter?.syncToGroup sg

            # should this stream accept requests to /?
            if opts.root_route
                @root_route = key

        # emit a streams event for any components under us that might
        # need to know
        debug "Done with configureStreams"
        @emit "streams", @streams

    #----------

    # Get a status snapshot by looping through each stream to return buffer
    # stats. Lets master know that we're still listening and current
    _streamStatus: (cb) ->
        status = {}

        totalKBytes         = 0
        totalConnections    = 0

        for key,s of @streams
            status[ key ] = s.status()

            totalKBytes += status[key].kbytes_sent
            totalConnections += status[key].connections

        cb null, _.extend status, _stats:{ kbytes_sent:totalKBytes, connections:totalConnections }

    #----------

    socketSource: (stream) ->
        new SocketSource @, stream

    #----------

    ejectListeners: (lFunc,cb) ->
        # transfer listeners, one at a time

        @log.info "Preparing to eject listeners from slave."

        @_enqueued = []

        # -- prep our listeners -- #

        for k,s of @streams
            @log.info "Preparing #{ Object.keys(s._lmeta).length } listeners for #{ s.key }"
            @_enqueued.push [s,obj] for id,obj of s._lmeta

        # -- short-circuit if there are no listeners -- #

        return cb?() if @_enqueued.length == 0

        # -- now send them one-by-one -- #

        sFunc = =>
            sl = @_enqueued.shift()

            if !sl
                @log.info "All listeners have been ejected."
                return cb null

            [stream,l] = sl

            # wrap the listener send in an error domain to try as
            # hard as we can to get it all there
            d = require("domain").create()
            d.on "error", (err) =>
                console.error "Handoff error: #{err}"
                @log.error "Eject listener for #{l.id} hit error: #{err}"
                d.exit()
                sFunc()

            d.run =>
                l.obj.prepForHandoff (skipHandoff=false) =>
                    # some listeners don't need handoffs
                    if skipHandoff
                        return sFunc()

                    socket = l.obj.socket
                    lopts =
                        key:        [stream.key,l.id].join("::"),
                        stream:     stream.key
                        id:         l.id
                        startTime:  l.startTime
                        client:     l.obj.client

                    # there's a chance that the connection could end
                    # after we recorded the id but before we get here.
                    # don't send in that case...
                    if socket && !socket.destroyed
                        lFunc lopts, socket, (err) =>
                            if err
                                @log.error "Failed to send listener #{lopts.id}: #{err}"

                            # move on to the next one...
                            sFunc()

                    else
                        @log.info "Listener #{lopts.id} perished in the queue. Moving on."
                        sFunc()

        sFunc()

    #----------

    landListener: (obj,socket,cb) ->
        # check and make sure they haven't disconnected mid-flight
        if socket && !socket.destroyed
            # create an output and attach it to the proper stream
            output = new @Outputs[ obj.client.output ] @streams[ obj.stream ],
                socket:     socket
                client:     obj.client
                startTime:  new Date(obj.startTime)

            cb null

        else
            cb "Listener disconnected in-flight"

    #----------
