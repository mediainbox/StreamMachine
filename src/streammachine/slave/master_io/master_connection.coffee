Socket = require "socket.io-client"
{Events} = require('../../events')

# This is the component that interacts with Master
# See events.
#


module.exports = class MasterConnection extends require("events").EventEmitter
    constructor: (@ctx) ->
        super()

        @logger = @ctx.logger.child(
            component: 'slave:master-connection'
        )
        @config = @ctx.config.slave

        @connected       = false
        @io              = null
        @id              = null
        @attempts        = 1
        @masterIndex     = -1
        @forceDisconnect = false

        # -- connect to the master server -- #

        @_start()

    #----------

    once_connected: (cb) ->
        if @connected
            cb null, @io
        else
            @once "connected", => cb null, @io

    #----------

    _start: ->
        master = @config.master

        if typeof master != "string"
            if master.length isnt (@masterIndex + 1)
                @masterIndex = @masterIndex + 1

            if @attempts >= @config.retry
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
        @logger.debug "connect to master at #{master}"

        @io = Socket.connect master, reconnection:true, timeout:@config.timeout

        # -- handle new connections -- #

        @io.on "connect", =>
            @logger.debug "Slave in _onConnect."

            # make sure our connection is valid with a ping
            pingTimeout = setTimeout =>
                @logger.error "Failed to get master OK ping."
                # FIXME: exit?
            , 1000

            @io.emit Events.IO.CONNECTION_OK, (res) =>
                clearTimeout pingTimeout

                if res == "OK"
                    # connect up our logging proxy
                    @logger.debug "Connected to master."
                    @id = @io.io.engine.id
                    @connected = true
                    @emit "connected"

                else
                    @logger.error "Master OK ping response invalid: #{res}"
                    # FIXME: exit?

        # -- handle errors -- #

        @io.on "connect_error", (err) =>
            if err.code =~ /ECONNREFUSED/
                @logger.info "Slave connection refused: #{err}"
            else
                @logger.info "Slave got connection error of #{err}", error:err
                console.log "got connection error of ", err

            @attempts = @attempts + 1

            if @isNecesaryReconnect()
                @_start()

        @io.on "disconnect", =>
            @connected = false
            @logger.debug "Disconnected from master."

            @emit "disconnect"
            # FIXME: Exit?

        @io.on Events.IO.CONFIG, (config) =>
            @ctx.slave.configureStreams config.streams

        @io.on Events.IO.SLAVE_STATUS, (cb) =>
            @ctx.slave._streamStatus cb

        @io.on Events.IO.AUDIO, (obj) =>
            # our data gets converted into an ArrayBuffer to go over the
            # socket. convert it back before insertion
            obj.chunk.data = Buffer.from(obj.chunk.data)

            # convert timestamp back to a date object
            obj.chunk.ts = new Date(obj.chunk.ts)

            @emit "audio:#{obj.stream}", obj.chunk

    #----------

    isNecesaryReconnect: ->
        master = @config.master

        if typeof master != "string"
            if @attempts < @config.retry
                return false

            else if master.length isnt (@masterIndex + 1)
                return true
        false

    #----------

    vitals: (key,cb) ->
        @io.emit Events.IO.SLAVE_VITALS, key, cb

    log: (obj) ->
        @io.emit "log", obj
