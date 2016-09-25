_       = require 'underscore'
Icy     = require "icy"

BaseOutput = require "./base"

debug = require("debug")("sm:outputs:shoutcast")

module.exports = class Shoutcast extends BaseOutput
    constructor: (@stream,@opts) ->
        @disconnected = false
        @id = null

        super "shoutcast"

        @pump = true

        @_lastMeta = null

        if @opts.req && @opts.res
            debug "Incoming Request Headers: ", @opts.req.headers
            # -- startup mode...  sending headers -- #

            @client.offsetSecs  = @opts.req.param("offset") || -1
            @client.meta_int    = @stream.opts.meta_interval

            @opts.res.chunkedEncoding = false
            @opts.res.useChunkedEncodingByDefault = false

            @headers =
                "Content-Type":
                    if @stream.opts.format == "mp3"         then "audio/mpeg"
                    else if @stream.opts.format == "aac"    then "audio/aacp"
                    else "unknown"
                "icy-name":             @stream.StreamTitle
                "icy-url":              @stream.StreamUrl
                "icy-metaint":          @client.meta_int
                "Accept-Ranges":        "none"

            # write out our headers
            @opts.res.writeHead 200, @headers
            @opts.res._send ''

            @stream.startSession @client, (err,session_id) =>
                debug "Incoming connection given session_id of #{session_id}"
                @client.session_id = session_id
                process.nextTick => @_startAudio(true)

        else if @opts.socket
            # -- socket mode... just data -- #

            @pump = false
            process.nextTick => @_startAudio(false)

        # register our various means of disconnection
        @socket.on "end",   => @disconnect()
        @socket.on "close", => @disconnect()
        @socket.on "error", => @disconnect()

    #----------

    _startAudio: (initial) ->
        # -- create an Icecast creator to inject metadata -- #

        # the initial interval value that we pass in may be different than
        # the one we want to use later.  Since the initializer queues the
        # first read, we can set both in succession without having to worry
        # about timing
        @ice = new Icy.Writer @client.bytesToNextMeta||@client.meta_int
        @ice.metaint = @client.meta_int
        delete @client.bytesToNextMeta

        # connect the icecast metadata injector to our output
        @ice.pipe(@socket)

        if initial && @stream.preroll && !@opts.req.param("preskip")
            debug "Pumping preroll"
            @stream.preroll.pump @, @ice, (err) =>
                debug "Back from preroll. Connecting to stream."
                @connectToStream()
        else
            @connectToStream()

    #----------

    disconnect: ->
        super =>
            @ice?.unpipe()
            @source?.disconnect()
            @socket?.end() unless @socket?.destroyed

    #----------

    prepForHandoff: (cb) ->
        # we need to know where we are in relation to the icecast metaint
        # boundary so that we can set up our new stream and keep everything
        # in sync

        @client.bytesToNextMeta = @ice._parserBytesLeft

        # remove the initial client.offsetSecs if it exists
        delete @client.offsetSecs

        cb?()

    #----------

    connectToStream: ->
        unless @disconnected
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

                    # set our offset (in chunks) now that it's been checked for availability
                    @client.offset = @source.offset()

                    @source.onFirstMeta (err,meta) =>
                        @ice.queue meta if meta

                    @metaFunc = (data) =>
                        unless @_lastMeta && _(data).isEqual(@_lastMeta)
                            @ice.queue data
                            @_lastMeta = data

                    # -- pipe source audio to icecast -- #

                    @source.pipe @ice
                    @source.on "meta", @metaFunc

    #----------

