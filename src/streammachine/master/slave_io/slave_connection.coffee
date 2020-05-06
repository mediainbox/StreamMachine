

module.exports = class SlaveConnection extends require("events").EventEmitter
    constructor: (@ctx, @socket) ->
        super()

        @id             = @socket.id
        @last_status    = null
        @last_err       = null
        @connected_at   = new Date()


        @logger = @ctx.logger.child({
            slave: @socket.id
        })

        # -- wire up logging -- #

        @logger = @logger.child slave:@socket.id
        @socket.on "log", (obj = {}) =>
            @logger[obj.level||'debug'].apply @logger, [obj.msg||"",obj.meta||{}]

        # -- RPC Handlers -- #

        @socket.on "vitals", (key, cb) =>
# respond with the stream's vitals
            @ctx.master.vitals key, cb

        # attach disconnect handler
        @socket.on "disconnect", =>
            @_handleDisconnect()

#----------

    status: (cb) ->
        @socket.emit "status", (err,status) =>
            @last_status    = status
            @last_err       = err

            cb err, status

#----------

    _handleDisconnect: ->
        connected = Math.round( (Number(new Date()) - Number(@connected_at)) / 60000 )
        @logger.debug "slave #{@socket.id} disconnected (connection lasted #{connected} minutes)"

        @emit "disconnect"
