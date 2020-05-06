module.exports = class IcecastSource extends require("./base")
    TYPE: -> "Icecast (#{[@opts.source_ip,@opts.sock.remotePort].join(":")})"
    HANDOFF_TYPE: "icecast"

    # opts should include:
    # format:   Format for Parser (aac or mp3)
    # sock:     Socket for incoming data
    # headers:  Headers from the source request
    # uuid:     Source UUID, if this is a handoff source (optional)
    # logger:   Logger (optional)
    constructor: (@opts) ->
        super useHeartbeat:true

        @_shouldHandoff = true

        # data is going to start streaming in as data on req. We need to pipe
        # it into a parser to turn it into frames, headers, etc

        @log?.debug "New Icecast source."

        @_vtimeout = setTimeout =>
            @log?.error "Failed to get source vitals before timeout. Forcing disconnect."
            @disconnect()
        , 3000

        @once "vitals", =>
            @log?.debug "Vitals parsed for source."
            clearTimeout @_vtimeout
            @_vtimeout = null

        @createParser()

        # incoming -> Parser
        @opts.sock.pipe @parser

        @last_ts = null

        # outgoing -> Stream
        @on "_chunk", (chunk) ->
            @last_ts = chunk.ts
            @emit "data", chunk

        @opts.sock.on "close", =>
            @log?.debug "Icecast source got close event"
            @disconnect()

        @opts.sock.on "end", =>
            @log?.debug "Icecast source got end event"
            @disconnect()

        # return with success
        @connected = true

    #----------

    status: ->
        source:         @TYPE?() ? @TYPE
        connected:      @connected
        url:            [@opts.source_ip,@opts.sock.remotePort].join(":")
        streamKey:      @streamKey
        uuid:           @uuid
        last_ts:        @last_ts
        connected_at:   @connectedAt

    #----------

    disconnect: ->
        if @connected
            super()

            clearTimeout @_vtimeout if @_vtimeout

            @opts.sock.destroy()
            @opts.sock.removeAllListeners()
            @connected = false
            @emit "disconnect"

            @removeAllListeners()
