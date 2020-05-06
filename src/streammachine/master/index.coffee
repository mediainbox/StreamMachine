_       = require "underscore"
temp    = require "temp"
net     = require "net"
fs      = require "fs"
express     = require "express"
Throttle    = require "throttle"

debug = require("debug")("sm:master:index")

Redis       = require "../stores/redis_store"
MasterConfigRedisStore = require "./config/redis_config"
MasterAPI         = require "./admin/api"
Stream      = require "./stream"
SourceIn    = require "./source_in"
Alerts      = require "../alerts"
Analytics   = require "../analytics"
Monitoring  = require "./monitoring"
SlaveServer     = require "./slave_io/slave_server"
SourceMount = require "./source_mount"

RewindDumpRestore   = require "../rewind/dump_restore"


Events = require('./events').MasterEvents


# A Master handles configuration, slaves, incoming sources, logging and the admin interface

module.exports = class Master extends require("events").EventEmitter
    constructor: (@ctx) ->
        super()

        @_configured = false

        @source_mounts  = {}
        @streams        = {}
        @stream_groups  = {}
        @proxies        = {}

        @config = @ctx.config
        @logger = @ctx.logger.child({
            component: "master"
        })
        @ctx.master = this

        @logger.debug "initialize Master"


        if @config.redis?
            # -- load our streams configuration from redis -- #

            # we store streams and sources into Redis, but not our full
            # config object. Other stuff still loads from the config file

            @logger.debug "Initializing Redis connection"
            @ctx.providers.redis = new Redis @config.redis
            @configStore = new MasterConfigRedisStore @ctx.providers.redis
            @configStore.on "config", (config) =>
                if config
                    # stash the configuration
                    @config = _.defaults config, @config

                    # (re-)configure our master stream objects
                    @configure @config

            # Persist changed configuration to Redis
            @logger.debug "Registering config_update listener"
            @on Events.CONFIG_UPDATE, =>
                @configStore._update @getStreamsAndSourceConfig(), (err) =>
                    @logger.info "Redis config update saved: #{err}"

        else
            # -- look for hard-coded configuration -- #

            process.nextTick =>
                @configure @config

        @once Events.STREAMS_UPDATE, =>
            @_configured = true

        # -- create a server to provide the API -- #

        @api = new MasterAPI @ctx

        # -- create a backend server for stream requests -- #

        @transport = new Master.StreamTransport @

        # -- start the source listener -- #

        @sourcein = new SourceIn @ctx

        # -- create an alerts object -- #
        @alerts = new Alerts logger:@logger.child(module:"alerts")

        # -- create a listener for slaves -- #

        if @config.master
            @slaves = new SlaveServer @ctx
            @on Events.STREAMS_UPDATE, =>
                @slaves.updateConfig @getStreamsAndSourceConfig()

        # -- Analytics -- #

        if @config.analytics?.es_uri
            @analytics = new Analytics
                config: @config.analytics
                log:    @logger.child(module:"analytics")
                redis:  @redis

            # add a log transport
            @logger.logger.add new Analytics.LogTransport(@analytics), {}, true

        # -- Rewind Dump and Restore -- #

        if @config.rewind_dump
            @rewind_dr = new RewindDumpRestore @, @config.rewind_dump

        # -- Set up our monitoring module -- #

        @monitoring = new Monitoring @, @logger.child(module:"monitoring")

    #----------

    once_configured: (cb) ->
        if @_configured
            cb()
        else
            @once Events.STREAMS_UPDATE, => cb()

    #----------

    loadRewinds: (cb) ->
        @once Events.STREAMS_UPDATE, =>
            @rewind_dr?.load cb

    #----------

    getStreamsAndSourceConfig: ->
        config = streams:{}, sources:{}

        config.streams[k] = s.config() for k,s of @streams
        config.sources[k] = s.config() for k,s of @source_mounts

        return config

    #----------

    # configre can be called on a new core, or it can be called to
    # reconfigure an existing core.  we need to support either one.
    configure: (options,cb) ->
        @logger.debug "configure master"

        all_keys = {}

        # -- Sources -- #

        new_sources = options?.sources || {}

        for k,opts of new_sources
            all_keys[ k ] = 1
            @logger.debug "Configuring Source Mapping #{k}"
            if @source_mounts[k]
                # existing...
                @source_mounts[k].configure opts
            else
                @_startSourceMount k, opts

        # -- Streams -- #

        # are any of our current streams missing from the new options? if so,
        # disconnect them
        new_streams = options?.streams || {}
        for k,obj of @streams
            if !new_streams?[k]
                @logger.debug "calling destroy on ", k
                obj.destroy()
                delete @streams[ k ]

        # run through the streams we've been passed, initializing sources and
        # creating rewind buffers
        for key,opts of new_streams
            @logger.debug "Parsing stream for #{key}"

            # does this stream have a mount?
            mount_key = opts.source || key
            all_keys[mount_key] = 1

            if !@source_mounts[mount_key]
                # create a mount
                @logger.debug "Creating an unspecified source mount for #{mount_key} (via #{key})."
                @_startSourceMount mount_key, _(opts).pick('source_password','format','monitored')

            mount = @source_mounts[mount_key]

            # do we need to create the stream?
            if @streams[key]
                # existing stream...  pass it updated configuration
                @logger.debug "Passing updated config to master stream: #{key}", opts:opts
                @streams[key].configure opts
            else
                @logger.debug "Starting up master stream: #{key}", opts:opts
                @_startStream key, mount, opts

            # part of a stream group?
            if g = @streams[key].opts.group
                # do we have a matching group?
                sg = ( @stream_groups[ g ] ||= new Stream.StreamGroup g, @logger.child stream_group:g )
                sg.addStream @streams[key]

        @emit Events.STREAMS_UPDATE, @streams

        # -- Remove Old Source Mounts -- #

        for k,obj of @source_mounts
            if !all_keys[k]
                @logger.debug "Destroying source mount #{k}"
                # FIXME: Implement?

        cb? null, streams:@streams, sources:@source_mounts

    #----------

    _startSourceMount: (key,opts) ->
        mount = new SourceMount key, @logger.child(source_mount:key), opts

        if mount
            @source_mounts[ key ] = mount
            @emit "new_source_mount", mount
            return mount
        else
            return false

    #----------

    _startStream: (key,mount,opts) ->
        stream = new Stream key, @logger.child(stream:key), mount, _.extend opts,
            hls:        @config.hls
            preroll:    if opts.preroll? then opts.preroll else @config.preroll
            transcoder: if opts.transcoder? then opts.transcoder else @config.transcoder
            log_interval: if opts.log_interval? then opts.log_interval else @config.log_interval

        if stream
            # attach a listener for configs
            stream.on "config", => @emit Events.CONFIG_UPDATE; @emit Events.STREAMS_UPDATE, @streams

            @streams[ key ] = stream
            @_attachIOProxy stream

            @emit "new_stream", stream
            return stream
        else
            return false

    #----------

    createStream: (opts,cb) ->
        @logger.debug "createStream called with ", opts

        # -- make sure the stream key is present and unique -- #

        if !opts.key
            cb? "Cannot create stream without key."
            return false

        if @streams[ opts.key ]
            cb? "Stream key must be unique."
            return false

        # -- Is there a Source Mount? -- #

        mount_key = opts.source || opts.key
        if !@source_mounts[mount_key]
            # create a mount
            @logger.debug "Creating an unspecified source mount for #{mount_key} (via #{opts.key})."
            @_startSourceMount mount_key, _(opts).pick('source_password','format')

        # -- create the stream -- #

        if stream = @_startStream opts.key, @source_mounts[mount_key], opts
            @emit Events.CONFIG_UPDATE
            @emit Events.STREAMS_UPDATE, @streams
            cb? null, stream.status()
        else
            cb? "Stream failed to start."

    #----------

    updateStream: (stream,opts,cb) ->
        @logger.info "updateStream called for ", key:stream.key, opts:opts

        # -- if they want to rename, the key must be unique -- #

        if opts.key && stream.key != opts.key
            if @streams[ opts.key ]
                cb? "Stream key must be unique."
                return false

            @streams[ opts.key ] = stream
            delete @streams[ stream.key ]

        # -- if we're good, ask the stream to configure -- #

        stream.configure opts, (err,config) =>
            if err
                cb? err
                return false


            cb? null, config

    #----------

    removeStream: (stream,cb) ->
        @logger.info "removeStream called for ", key:stream.key

        delete @streams[ stream.key ]
        stream.destroy()

        @emit Events.CONFIG_UPDATE
        @emit Events.STREAMS_UPDATE, @streams

        cb? null, "OK"

    #----------

    createMount: (opts,cb) ->
        @logger.info "createMount called for #{opts.key}", opts:opts

        # -- make sure the mount key is present and unique -- #

        if !opts.key
            cb? "Cannot create mount without key."
            return false

        if @source_mounts[ opts.key ]
            cb? "Mount key must be unique."
            return false

        if mount = @_startSourceMount opts.key, opts
            @emit Events.CONFIG_UPDATE
            cb? null, mount.status()
        else
            cb? "Mount failed to start."

    #----------

    updateMount: (mount,opts,cb) ->
        @logger.info "updateMount called for #{mount.key}", opts:opts

        # -- if they want to rename, the key must be unique -- #

        if opts.key && mount.key != opts.key
            if @source_mounts[ opts.key ]
                cb? "Mount key must be unique."
                return false

            @source_mounts[ opts.key ] = mount
            delete @source_mounts[ mount.key ]

        # -- if we're good, ask the mount to configure -- #

        mount.configure opts, (err,config) =>
            return cb? err if err
            cb? null, config

    #----------

    removeMount: (mount,cb) ->
        @logger.info "removeMount called for #{mount.key}"

        # it's illegal to remove a mount that still has streams hooked up to it
        if mount.listeners("data").length > 0
            cb new Error("Cannot remove source mount until all streams are removed")
            return false

        delete @source_mounts[ mount.key ]
        mount.destroy()

        @emit Events.CONFIG_UPDATE

        cb null, "OK"

    #----------

    streamsInfo: ->
        obj.status() for k,obj of @streams

    groupsInfo: ->
        obj.status() for k,obj of @stream_groups

    sourcesInfo: ->
        obj.status() for k,obj of @source_mounts

    #----------

    vitals: (stream,cb) ->
        if s = @streams[ stream ]
            s.vitals cb
        else
            cb "Invalid Stream"

    #----------

    getHLSSnapshot: (stream,cb) ->
        if s = @streams[ stream ]
            s.getHLSSnapshot cb
        else
            cb "Invalid Stream"

    #----------

    status: ->
        streams:    @streamsInfo()
        groups:     @groupsInfo()
        sources:    @sourcesInfo()

    #----------

    # Get a status snapshot by looping through each stream to get buffer stats
    _rewindStatus: ->
        status = {}
        status[ key ] = s.rewind._rStatus() for key,s of @streams
        status

    #----------

    slavesInfo: ->
        if @slaves
            slaveCount: Object.keys(@slaves.slaves).length
            slaves:     ( { id:k, status:s.last_status||"WARMING UP" } for k,s of @slaves.slaves )
            master:     @_rewindStatus()
        else
            slaveCount: 0
            slaves:     []
            master:     @_rewindStatus()

    #----------

    sendHandoffData: (rpc,cb) ->
        fFunc = _.after 2, =>
            @logger.info "Rewind buffers and sources sent."
            cb null

        # -- Source Mounts -- #

        rpc.once "sources", (msg,handle,cb) =>
            @logger.info "Received request for sources."

            # iterate through each source mount, sending each of its sources

            mounts = _.values @source_mounts

            _sendMount = =>
                mount = mounts.shift()

                if !mount
                    cb null
                    return fFunc()

                sources = mount.sources.slice()

                _sendSource = =>
                    source = sources.shift()
                    return _sendMount() if !source

                    @logger.info "Sending source #{mount.key}/#{source.uuid}"
                    rpc.request "source",
                        mount:      mount.key
                        type:       source.HANDOFF_TYPE
                        opts:       format:source.opts.format, uuid:source.uuid, source_ip:source.opts.source_ip, connectedAt:source.connectedAt
                    , source.opts.sock
                    , (err,reply) =>
                        @logger.error "Error sending source #{mount.key}/#{source.uuid}: #{err}" if err
                        _sendSource()

                _sendSource()

            _sendMount()

        # -- Stream Rewind Buffers -- #

        rpc.once "stream_rewinds", (msg,handle,cb) =>
            @logger.info "Received request for rewind buffers."

            streams = _(@streams).values()

            _sendStream = =>
                stream = streams.shift()

                if !stream
                    cb null
                    return fFunc()

                _next = _.once =>
                    _sendStream()

                if stream.rewind.bufferedSecs() > 0
                    # set up a socket to accept the buffer on
                    spath = temp.path suffix:".sock"

                    @logger.info "Asking to send rewind buffer for #{stream.key} over #{spath}."

                    sock = net.createServer()

                    sock.listen spath, =>
                        sock.once "connection", (c) =>
                            stream.getRewind (err,writer) =>
                                if err
                                    @logger.error "Failed to get rewind buffer for #{stream.key}"
                                    _next()

                                writer.pipe(c)
                                writer.once "end", =>
                                    @logger.info "RewindBuffer for #{ stream.key } written to socket."

                        rpc.request "stream_rewind", key:stream.key,path:spath, null, timeout:10000, (err) =>
                            if err
                                @logger.error "Error sending rewind buffer for #{stream.key}: #{err}"
                            else
                                @logger.info "Rewind buffer sent and ACKed for #{stream.key}"

                            # cleanup...
                            sock.close => fs.unlink spath, (err) =>
                                @logger.info "RewindBuffer socket unlinked.", error:err
                                _next()
                else
                    # no need to send a buffer for an empty stream
                    _next()

            _sendStream()

    #----------

    loadHandoffData: (rpc,cb) ->
        # -- set up a listener for stream rewinds and sources -- #

        rpc.on "source", (msg,handle,cb) =>
            mount = @source_mounts[ msg.mount ]
            source = new (require "../sources/#{msg.type}") _.extend {}, msg.opts, sock:handle, logger:mount.log
            mount.addSource source
            @logger.info "Added mount source: #{mount.key}/#{source.uuid}"
            cb null

        rpc.on "stream_rewind", (msg,handle,cb) =>
            stream = @streams[msg.key]

            @logger.info "Stream Rewind will load over #{msg.path}."

            sock = net.connect msg.path, (err) =>
                @logger.info "Reader socket connected for rewind buffer #{msg.key}", error:err
                return cb err if err

                stream.rewind.loadBuffer sock, (err,stats) =>
                    if err
                        @logger.error "Error loading rewind buffer: #{err}"
                        cb err

                    cb null

        af = _.after 2, =>
            cb null


        # -- Request Sources -- #

        rpc.request "sources", {}, null, timeout:10000, (err) =>
            if err
                @logger.error "Failed to get sources from handoff initiator: #{err}"
            else
                @logger.info "Received sources from handoff initiator."

            af()

        # -- Request Stream Rewind Buffers -- #

        rpc.request "stream_rewinds", {}, null, timeout:10000, (err) =>
            if err
                @logger.error "Failed to get stream rewinds from handoff initiator: #{err}"
            else
                @logger.info "Received stream rewinds from handoff initiator."

            af()

    #----------

    _attachIOProxy: (stream) ->
        @logger.debug "attachIOProxy call for #{stream.key}.", slaves:@slaves?, proxy:@proxies[stream.key]?
        return false if !@slaves

        if @proxies[ stream.key ]
            return false

        # create a new proxy
        @logger.debug "Creating StreamProxy for #{stream.key}"
        @proxies[ stream.key ] = new Master.StreamProxy key:stream.key, stream:stream, master:@

        # and attach a listener to destroy it if the stream is removed
        stream.once "destroy", =>
            @proxies[ stream.key ]?.destroy()
            delete @proxies[ stream.key ]

    #----------

    class @StreamTransport
        constructor: (@master) ->
            @app = express()

            # -- Param Handlers -- #

            @app.param "stream", (req,res,next,key) =>
                # make sure it's a valid stream key
                if key? && s = @master.streams[ key ]
                    req.stream = s
                    next()
                else
                    res.status(404).end "Invalid stream.\n"

            # -- Validate slave id -- #

            @app.use (req,res,next) =>
                sock_id = req.get 'stream-slave-id'
                if sock_id && @master.slaves.slaves[ sock_id ]
                    #req.slave_socket = @master.slaves[ sock_id ]
                    next()

                else
                    @master.logger.debug "Rejecting StreamTransport request with missing or invalid socket ID.", sock_id:sock_id
                    res.status(401).end "Missing or invalid socket ID.\n"

            # -- Routes -- #

            @app.get "/:stream/rewind", (req,res) =>
                @master.logger.debug "Rewind Buffer request from slave on #{req.stream.key}."
                res.status(200).write ''
                req.stream.getRewind (err,writer) =>
                    writer.pipe( new Throttle 100*1024*1024 ).pipe(res)
                    res.on "end", =>
                        @master.logger.debug "Rewind dumpBuffer finished."

    #----------

    class @StreamProxy extends require("events").EventEmitter
        constructor: (opts) ->
            super()

            @key = opts.key
            @stream = opts.stream
            @master = opts.master

            @dataFunc = (chunk) =>
                @master.slaves.broadcastAudio @key, chunk

            @stream.on "data", @dataFunc

        destroy: ->
            @stream.removeListener "data", @dataFunc
            @stream = null
            @emit "destroy"

            @removeAllListeners()

    #----------
