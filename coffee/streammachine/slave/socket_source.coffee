http = require "http"

# emulate a source connection, receiving data via sockets from our master server

module.exports = class SocketSource extends require("events").EventEmitter
    constructor: (@slave,@stream) ->
        super()

        @log = @stream.log.child subcomponent:"socket_source"

        @log.debug "created SocketSource for #{@stream.key}"

        @slave.masterConnection.on "audio:#{@stream.key}", (chunk) =>
            @emit "data", chunk

        @_streamKey = null

        getVitals = (retries=0) =>
            @slave.masterConnection.vitals @stream.key, (err,obj) =>
                if err
                    @log.error "Failed to get vitals (#{retries} retries remaining): #{err}"

                    if retries > 0
                        getVitals()

                    return

                @_streamKey = obj.streamKey
                @_vitals    = obj
                @emit "vitals", obj

        getVitals 2

        @stream.once "disconnect", =>
            getVitals = ->
            @disconnect()

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
        if @_streamKey
            cb? @_streamKey
        else
            @once "vitals", => cb? @_streamKey

    #----------

    getRewind: (cb) ->
        # connect to the master's StreamTransport and ask for any rewind
        # buffer that is available

        gRT = setTimeout =>
            @log.debug "Failed to get rewind buffer response."
            cb? "Failed to get a rewind buffer response."
        , 15000

        # connect to: @master.options.host:@master.options.port

        # GET request for rewind buffer
        @log.debug "Making Rewind Buffer request for #{@stream.key}", sock_id:@slave.masterConnection.id
        req = http.request
            hostname:   @slave.masterConnection.io.io.opts.host
            port:       @slave.masterConnection.io.io.opts.port
            path:       "/s/#{@stream.key}/rewind"
            headers:
                'stream-slave-id':    @slave.masterConnection.id
        , (res) =>
            clearTimeout gRT

            @log.debug "Got Rewind response with status code of #{ res.statusCode }"
            if res.statusCode == 200
                # emit a 'rewind' event with a callback to get the response
                cb? null, res

            else
                cb? "Rewind request got a non-500 response."

        req.on "error", (err) =>
            clearTimeout gRT

            @log.debug "Rewind request got error: #{err}", error:err
            cb? err

        req.end()

    #----------

    disconnect: ->
        @log.debug "SocketSource disconnecting for #{@stream.key}"

        @stream = null