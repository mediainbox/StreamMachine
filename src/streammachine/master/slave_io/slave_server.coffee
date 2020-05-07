_ = require "underscore"
SocketIO = require("socket.io")
SlaveConnection = require('./slave_connection')
{Events} = require('../../events')

# Socket.IO server that listens for Slave connections
# Will create a SlaveConnection for each connected Slave
# See also slave/MasterConnection for the counterpart on the slave
# Emits:
# - Events.IO.CONFIG
# - Events.IO.AUDIO

CONFIG_UPDATE_DEBOUNCE = 200

module.exports = class SlaveServer extends require("events").EventEmitter
    constructor: (@ctx) ->
        super()

        @master = @ctx.master
        @config = @ctx.config
        @logger = @ctx.logger.child({
            component:  "slave_server"
        })

        @io         = null
        @slaveConnections     = {}
        @_config    = null

        cUpdate = _.debounce =>
            config = @master.config()
            for id, s of @slaveConnections
                @logger.debug "emit config to slave #{ id }"
                s.socket.emit Events.IO.CONFIG, config
        , CONFIG_UPDATE_DEBOUNCE

        @master.on Events.Master.CONFIG_UPDATE, cUpdate

    #----------

    updateConfig: (config) ->
        @_config = config

        for id,s of @slaveConnections
            s.socket.emit Events.IO.CONFIG, config

    #----------

    listen: (server) ->
        # fire up a socket listener on our slave port
        @io = SocketIO.listen server

        @logger.info "master now listening for ws slave connections"

        # add our authentication
        @io.use (socket,next) =>
            @logger.debug "Authenticating slave connection."
            if @config.master.password == socket.request._query?.password
                @logger.debug "Slave password is valid."
                next()
            else
                @logger.warn "Slave password is incorrect."
                next new Error "Invalid slave password."

        # look for slave connections
        @io.on "connect", (sock) =>
            @logger.debug "Master got connection"
            # a slave may make multiple connections to test transports. we're
            # only interested in the one that gives us the OK
            sock.once Events.IO.CONNECTION_OK, (cb) =>
                @logger.debug "Got OK from incoming slave connection at #{sock.id}"

                # ping back to let the slave know we're here
                cb "OK"

                @logger.debug "slave connection is #{sock.id}"

                sock.emit Events.IO.CONFIG, @_config if @_config

                @slaveConnections[sock.id] = new SlaveConnection @ctx, sock

                @slaveConnections[sock.id].on Events.IO.DISCONNECT, =>
                    delete @slaveConnections[ sock.id ]
                    @emit "disconnect", sock.id

    #----------

    broadcastAudio: (k,chunk) ->
        for id,s of @slaveConnections
            s.socket.emit Events.IO.AUDIO, {stream:k,chunk:chunk}

    #----------

    pollForSync: (cb) ->
        statuses = []

        cb = _.once cb

        af = _.after Object.keys(@slaveConnections).length, =>
            cb null, statuses

        # -- now check the slaves -- #

        for s,obj of @slaveConnections
            do (s,obj) =>
                saf = _.once af

                sstat = id:obj.id, UNRESPONSIVE:false, ERROR:null, status:{}
                statuses.push sstat

                pollTimeout = setTimeout =>
                    @logger.error "Slave #{s} failed to respond to status."
                    sstat.UNRESPONSIVE = true
                    saf()
                , 1000

                obj.status (err,stat) =>
                    clearTimeout pollTimeout

                    @logger.error "Slave #{s} reported status error: #{err}" if err

                    sstat.ERROR = err
                    sstat.status = stat
                    saf()
