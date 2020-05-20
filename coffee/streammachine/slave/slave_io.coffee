Socket = require "socket.io-client"

module.exports = class SlaveIO extends require("events").EventEmitter
    constructor: (@slave,@_log,@opts) ->
        @connected       = false
        @io              = null
        @id              = null
        @attempts        = 1
        @masterIndex     = -1
        @forceDisconnect = false

        # -- connect to the master server -- #

        @_log.debug "Connecting to master at ", master:@opts.master

        @_start()

    #----------

    once_connected: (cb) ->
        if @connected
            cb null, @io
        else
            @once "connected", => cb null, @io

    #----------

    _start: ->
        master = @opts.master

        if typeof master != "string"
            if master.length isnt (@masterIndex + 1)
                @masterIndex = @masterIndex + 1

            if @attempts >= @opts.retry
                @attempts = 1

            master = master[@masterIndex]

        @disconnect()
        @_connect(master)

    #----------

    disconnect: ->
        @forceDisconnect = true
        @io?.disconnect()

    #----------

    _connect: (master) ->
        @_log.info "Slave trying connection to master #{ master }"

        @io = Socket.connect master, reconnection:true, timeout:@opts.timeout

        # -- handle new connections -- #

        @io.on "connect", =>
            @_log.debug "Slave in _onConnect."

            # make sure our connection is valid with a ping
            pingTimeout = setTimeout =>
                @_log.error "Failed to get master OK ping."
                # FIXME: exit?
            , 1000

            @io.emit "ok", (res) =>
                clearTimeout pingTimeout

                if res == "OK"
                    # connect up our logging proxy
                    @_log.debug "Connected to master."
                    @id = @io.io.engine.id
                    @connected = true
                    @emit "connected"

                else
                    @_log.error "Master OK ping response invalid: #{res}"
                    # FIXME: exit?

        # -- handle errors -- #

        @io.on "connect_error", (err) =>
            if err.code =~ /ECONNREFUSED/
                @_log.info "Slave connection refused: #{err}"
            else
                @_log.info "Slave got connection error of #{err}", error:err
                console.log "got connection error of ", err

            @attempts = @attempts + 1

            if @isNecesaryReconnect()
                @_start()

        # -- handle disconnects -- #

        @io.on "disconnect", =>
            @connected = false
            @_log.debug "Disconnected from master."

            @emit "disconnect"
            # FIXME: Exit?

        # -- RPC calls -- #

        @io.on "config", (config) =>
            @slave.configureStreams config.streams

        @io.on "status", (cb) =>
            @slave._streamStatus cb

        @io.on "should_shutdown", (cb) =>
            @slave._shutdown cb

        @io.on "audio", (obj) =>
            # our data gets converted into an ArrayBuffer to go over the
            # socket. convert it back before insertion
            obj.chunk.data = Buffer.from(obj.chunk.data)

            # convert timestamp back to a date object
            obj.chunk.ts = new Date(obj.chunk.ts)

            @emit "audio:#{obj.stream}", obj.chunk

        @io.on "hls_snapshot", (obj) =>
            # run through the snapshot and convert timestamps back into date
            # objects
            for s in obj.snapshot?.segments||[]
                for k in ['ts','end_ts','ts_actual','end_ts_actual']
                    s[k] = new Date(s[k]) if s[k]

            @emit "hls_snapshot:#{obj.stream}", obj.snapshot

    #----------

    isNecesaryReconnect: ->
        master = @opts.master

        if typeof master != "string"
            if @attempts < @opts.retry
                return false

            else if master.length isnt (@masterIndex + 1)
                return true
        false

    #----------

    vitals: (key,cb) ->
        @io.emit "vitals", key, cb

    hls_snapshot: (key,cb) ->
        @io.emit "hls_snapshot", key, (err,snapshot) =>
            for s in snapshot?.segments||[]
                for k in ['ts','end_ts','ts_actual','end_ts_actual']
                    s[k] = new Date(s[k]) if s[k]

            cb err,snapshot

    log: (obj) ->
        @io.emit "log", obj
