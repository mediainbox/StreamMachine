BaseOutput = require "./base"

debug = require("debug")("sm:outputs:raw_audio")

module.exports = class RawAudio extends BaseOutput
    constructor: (@stream,@opts) ->
        @disconnected = false

        debug "Incoming request."

        super "raw"

        @pump = true

        if @opts.req && @opts.res
            @client.offsetSecs  = @opts.req.query.offset || -1

            @opts.res.chunkedEncoding = false
            @opts.res.useChunkedEncodingByDefault = false

            headers =
                "Content-Type":
                    if @stream.opts.format == "mp3"         then "audio/mpeg"
                    else if @stream.opts.format == "aac"    then "audio/aacp"
                    else "unknown"
                "Accept-Ranges": "none"

            # write out our headers
            @opts.res.writeHead 200, headers
            @opts.res._send ''

            process.nextTick =>
                @stream.startSession @client, (err,session_id) =>
                    @client.session_id = session_id

                    # -- send a preroll if we have one -- #

                    if @stream.preroll && !@opts.req.query.preskip
                        debug "making preroll request on stream #{@stream.key}"
                        @stream.preroll.pump @, @socket,
                            (err) => @connectToStream()
                    else
                        @connectToStream()

        else if @opts.socket
            # -- just the data -- #

            @pump = false
            process.nextTick => @connectToStream()

        else
            # fail
            @stream.log.error "Listener passed without connection handles or socket."

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

    #----------

    prepForHandoff: (cb) ->
        # remove the initial client.offsetSecs if it exists
        delete @client.offsetSecs

        cb?()

    #----------

    connectToStream: ->
        unless @disconnected
            debug "Connecting to stream #{@stream.key}"
            @stream.listen @,
                offsetSecs:     @client.offsetSecs,
                offset:         @client.offset,
                pump:           @pump,
                startTime:      @opts.startTime,
                (err,@source) =>
                    if err
                        if @opts.res?
                            @opts.res.status(500).end err
                        else
                            @socket?.end()

                        return false

                    # update our offset now that it's been checked for availability
                    @client.offset = @source.offset()

                    @source.pipe @socket
