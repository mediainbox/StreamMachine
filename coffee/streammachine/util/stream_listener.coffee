Icy = require "icy"
http = require "http"

debug = require("debug")("sm:util:stream_listener")
_ = require "underscore"

module.exports = class StreamListener extends require("events").EventEmitter
    constructor: (@host,@port,@stream,@shoutcast=false) ->
        @bytesReceived = 0

        @url = "http://#{@host}:#{@port}/#{@stream}"

        @req = null
        @res = null

        debug "Created new Stream Listener for #{@url}"

        @disconnected = false

    #----------

    connect: (timeout,cb) ->
        if _.isFunction(timeout)
            cb = timeout
            timeout = null

        aborted = false
        if timeout
            abortT = setTimeout =>
                aborted = true
                cb new Error("Reached timeout without successful connection.")
            , timeout

        _connected = (res) =>
            clearTimeout abortT if abortT

            @res = res

            debug "Connected. Response code is #{ res.statusCode }."

            if res.statusCode != 200
                cb new Error("Non-200 Status code: #{ res.statusCode }")
                return false

            cb?()
            @emit "connected"

            # -- listen for data -- #

            @res.on "metadata", (meta) =>
                @emit "metadata", Icy.parse(meta)

            @res.on "readable", =>
                while data = @res.read()
                    @bytesReceived += data.length
                    @emit "bytes"

            # -- listen for an early exit -- #

            @res.once "error", (err) =>
                debug "Listener connection error: #{err}"
                @emit "error" if !@disconnected

            @res.once "close", =>
                debug "Listener connection closed."

                @emit "close" if !@disconnected

        connect_func = if @shoutcast then Icy.get else http.get

        cLoop = =>
            debug "Attempting connect to #{@url}"
            @req = connect_func @url, _connected
            @req.once "socket", (sock) => @emit "socket", sock
            @req.once "error", (err) =>
                if err.code == "ECONNREFUSED"
                    setTimeout cLoop, 50 if !aborted
                else
                    cb err

        cLoop()

    #----------

    disconnect: (cb) ->
        @disconnected = true
        @res.socket.destroy()
        cb?()
