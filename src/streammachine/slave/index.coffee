_ = require "underscore"

Stream  = require "./stream"
Server  = require "./server"
Alerts  = require "../alerts"
MasterConnection      = require "./master_io/master_connection"
SocketSource = require "./socket_source"
{ EventTypes, EventsHub } = require('./events')
tz      = require 'timezone'

module.exports = class Slave extends require("events").EventEmitter
    Outputs:
        pumper:         require "../outputs/pumper"
        shoutcast:      require "../outputs/shoutcast"
        raw:            require "../outputs/raw_audio"

    constructor: (@ctx) ->
        super()

        @_configured = false

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

        @ctx.events = new EventsHub
        @ctx.slave = @
        @config = @ctx.config
        @logger = @ctx.logger.child({
            component: "slave"
        })
        @logger.debug "initialize slave"

        # -- create an alerts object -- #

        @alerts = new Alerts logger:@logger.child(module:"alerts")

        # -- Make sure we have the proper slave config options -- #

        if @config.slave?.master
            @masterConnection = new MasterConnection @ctx

            @masterConnection.on "connected", =>
                @logger.debug "IO is connected"
                @alerts.update "slave_disconnected", @masterConnection.id, false
                # TODO @logger.proxyToMaster(@masterConnection)

            @masterConnection.on "disconnected", =>
                @logger.debug "IO is disconnected"
                @alerts.update "slave_disconnected", @masterConnection.id, true
                # TODO @logger.proxyToMaster()

        @once "streams", =>
            @logger.debug "Streams event received"
            @_configured = true

        # -- set up our stream server -- #

        @server = new Server core:@, logger:@logger.child(subcomponent:"server"), config:@config

    #----------

    once_configured: (cb) ->
        if @_configured
            cb()
        else
            @once "streams", => cb()

    once_rewinds_loaded: (cb) ->
        @once_configured =>
            @logger.debug "Looking for sources to load in #{ Object.keys(@streams).length } streams."
            aFunc = _.after Object.keys(@streams).length, =>
                @logger.debug "All sources are loaded."
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
        @logger.debug "In configureStreams"
        @logger.debug "In slave configureStreams with ", options:options

        # are any of our current streams missing from the new options? if so,
        # disconnect them
        for k,obj of @streams
            if !options?[k]
                @logger.debug "configureStreams: Disconnecting stream #{k}"
                @logger.info "configureStreams: Calling disconnect on #{k}"
                obj.disconnect()
                delete @streams[k]

        # run through the streams we've been passed, initializing sources and
        # creating rewind buffers

        @logger.debug "configureStreams: New options start"
        for key,opts of options
            @logger.debug "configureStreams: Configuring #{key}"
            if @streams[key]
                # existing stream...  pass it updated configuration
                @logger.debug "Passing updated config to stream: #{key}", opts:opts
                @streams[key].configure opts
            else
                @logger.debug "Starting up stream: #{key}", opts:opts

                # FIXME: Eventually it would make sense to allow a per-stream
                # value here
                opts.tz = tz(require "timezone/zones")(@config.timezone||"UTC")

                stream = @streams[key] = new Stream @, key, @logger.child(stream:key), opts

                if @masterConnection
                    source = @socketSource stream
                    stream.useSource source

            # should this stream accept requests to /?
            if opts.root_route
                @root_route = key

        # emit a streams event for any components under us that might
        # need to know
        @logger.debug "Done with configureStreams"
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

        @logger.info "Preparing to eject listeners from slave."

        @_enqueued = []

        # -- prep our listeners -- #

        for k,s of @streams
            @logger.info "Preparing #{ Object.keys(s._lmeta).length } listeners for #{ s.key }"
            @_enqueued.push [s,obj] for id,obj of s._lmeta

        # -- short-circuit if there are no listeners -- #

        return cb?() if @_enqueued.length == 0

        # -- now send them one-by-one -- #

        sFunc = =>
            sl = @_enqueued.shift()

            if !sl
                @logger.info "All listeners have been ejected."
                return cb null

            [stream,l] = sl

            # wrap the listener send in an error domain to try as
            # hard as we can to get it all there
            d = require("domain").create()
            d.on "error", (err) =>
                console.error "Handoff error: #{err}"
                @logger.error "Eject listener for #{l.id} hit error: #{err}"
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
                                @logger.error "Failed to send listener #{lopts.id}: #{err}"

                            # move on to the next one...
                            sFunc()

                    else
                        @logger.info "Listener #{lopts.id} perished in the queue. Moving on."
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
