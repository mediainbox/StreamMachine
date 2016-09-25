BaseOutput = require "./base"

debug = require("debug")("sm:outputs:pumper")

module.exports = class Pumper extends BaseOutput
    constructor: (@stream,@opts) ->
        super "pumper"

        # figure out what we're pulling
        @stream.listen @,
            offsetSecs: @opts.req.param("from") || @opts.req.param("pump")
            pump:       @opts.req.param("pump")
            pumpOnly:   true
        , (err,@source,info) =>
            if err
                @opts.res.status(500).end err
                return false

            headers =
                "Content-Type":
                    if @stream.opts.format == "mp3"         then "audio/mpeg"
                    else if @stream.opts.format == "aac"    then "audio/aacp"
                    else "unknown"
                "Connection":           "close"
                "Content-Length":       info.length

            # write out our headers
            @opts.res.writeHead 200, headers

            # send our pump buffer to the client
            @source.pipe(@opts.res)

            # register our various means of disconnection
            @socket.on "end",   => @disconnect()
            @socket.on "close", => @disconnect()
            @socket.on "error", (err) =>
                @stream.log.debug "Got client socket error: #{err}"
                @disconnect()

    #----------

    disconnect: ->
        super =>
            @source?.disconnect()
            @socket?.end() unless (@socket.destroyed)