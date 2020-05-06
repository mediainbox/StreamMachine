_ = require "underscore"
SocketIO = require("socket.io")
SlaveConnection = require('./slave_connection')

module.exports = class SlaveServer extends require("events").EventEmitter
    constructor: (@ctx) ->
        super()

        @master = @ctx.master
        @config = @ctx.config
        @logger = @ctx.logger.child({
            component:  "slave_server"
        })

        @io         = null
        @slaves     = {}
        @_config    = null

        cUpdate = _.debounce =>
            config = @master.config()
            for id, s of @slaves
                @logger.debug "emit config to slave #{ id }"
                s.socket.emit "config", config
        , 200

        @master.on "config_update", cUpdate

    #----------

    updateConfig: (config) ->
        @_config = config

        for id,s of @slaves
            s.socket.emit "config", config

    #----------

    listen: (server) ->
        # fire up a socket listener on our slave port
        @io = SocketIO.listen server

        @logger.info "Master now listening for slave connections."

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
        @io.on "connection", (sock) =>
            @logger.debug "Master got connection"
            # a slave may make multiple connections to test transports. we're
            # only interested in the one that gives us the OK
            sock.once "ok", (cb) =>
                @logger.debug "Got OK from incoming slave connection at #{sock.id}"

                # ping back to let the slave know we're here
                cb "OK"

                @logger.debug "slave connection is #{sock.id}"

                sock.emit "config", @_config if @_config

                @slaves[sock.id] = new SlaveConnection @ctx, sock

                @slaves[sock.id].on "disconnect", =>
                    delete @slaves[ sock.id ]
                    @emit "disconnect", sock.id

    #----------

    broadcastAudio: (k,chunk) ->
        for id,s of @slaves
            s.socket.emit "audio", {stream:k,chunk:chunk}

    #----------

    pollForSync: (cb) ->
        statuses = []

        cb = _.once cb

        af = _.after Object.keys(@slaves).length, =>
            cb null, statuses

        # -- now check the slaves -- #

        for s,obj of @slaves
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
