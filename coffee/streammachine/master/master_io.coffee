_ = require "underscore"

debug = require("debug")("sm:master:master_io")

module.exports = class MasterIO extends require("events").EventEmitter
    constructor: (@master,@log,@opts) ->
        @io         = null
        @slaves     = {}

        @_config    = null

        cUpdate = _.debounce =>
            config = @master.config()
            for id,s of @slaves
                @log.debug "emit config to slave #{ id }"
                s.sock.emit "config", config
        , 200

        @master.on "config_update", cUpdate

    #----------

    updateConfig: (config) ->
        @_config = config

        for id,s of @slaves
            s.sock.emit "config", config

    #----------

    listen: (server) ->
        # fire up a socket listener on our slave port
        @io = require("socket.io").listen server

        @log.info "Master now listening for slave connections."

        # add our authentication
        @io.use (socket,next) =>
            debug "Authenticating slave connection."
            if @opts.password == socket.request._query?.password
                debug "Slave password is valid."
                next()
            else
                @log.debug "Slave password is incorrect."
                debug "Slave password is incorrect."
                next new Error "Invalid slave password."

        # look for slave connections
        @io.on "connection", (sock) =>
            debug "Master got connection"
            # a slave may make multiple connections to test transports. we're
            # only interested in the one that gives us the OK
            sock.once "ok", (cb) =>
                debug "Got OK from incoming slave connection at #{sock.id}"

                # ping back to let the slave know we're here
                cb "OK"

                @log.debug "slave connection is #{sock.id}"

                sock.emit "config", @_config if @_config

                @slaves[sock.id] = new Slave @, sock

                @slaves[sock.id].on "disconnect", =>
                    delete @slaves[ sock.id ]
                    @emit "disconnect", sock.id

    #----------

    broadcastHLSSnapshot: (k,snapshot) ->
        for id,s of @slaves
            s.sock.emit "hls_snapshot", {stream:k,snapshot:snapshot}

    #----------

    broadcastAudio: (k,chunk) ->
        for id,s of @slaves
            s.sock.emit "audio", {stream:k,chunk:chunk}

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
                    @log.error "Slave #{s} failed to respond to status."
                    sstat.UNRESPONSIVE = true
                    saf()
                , 1000

                obj.status (err,stat) =>
                    clearTimeout pollTimeout

                    @log.error "Slave #{s} reported status error: #{err}" if err

                    sstat.ERROR = err
                    sstat.status = stat
                    saf()

    #----------

    class Slave extends require("events").EventEmitter
        constructor: (@sio,@sock) ->
            @id             = @sock.id
            @last_status    = null
            @last_err       = null
            @connected_at   = new Date()

            # -- wire up logging -- #

            @socklogger = @sio.log.child slave:@sock.id
            @sock.on "log", (obj = {}) =>
                @socklogger[obj.level||'debug'].apply @socklogger, [obj.msg||"",obj.meta||{}]

            # -- RPC Handlers -- #

            @sock.on "vitals", (key, cb) =>
                # respond with the stream's vitals
                @sio.master.vitals key, cb

            @sock.on "hls_snapshot", (key,cb) =>
                # respond with the current array of HLS segments for this stream
                @sio.master.getHLSSnapshot key, cb

            # attach disconnect handler
            @sock.on "disconnect", =>
                @_handleDisconnect()

        #----------

        status: (cb) ->
            @sock.emit "status", (err,status) =>
                @last_status    = status
                @last_err       = err

                cb err, status

        #----------

        _handleDisconnect: ->
            connected = Math.round( (Number(new Date()) - Number(@connected_at)) / 1000 )
            @sio.log.debug "Slave disconnect from #{@sock.id}. Connected for #{ connected } seconds."

            @emit "disconnect"
