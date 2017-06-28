Icy     = require 'icy'
util    = require 'util'
url     = require 'url'
domain  = require "domain"
moment  = require "moment"
_       = require "underscore"

debug   = require("debug")("sm:sources:proxy")

module.exports = class ProxySource extends require("./base")
    TYPE: -> "Proxy (#{@url})"

    # opts should include:
    # format:   Format for Parser (aac or mp3)
    # url:      URL for original stream
    # fallback: Should we set the isFallback flag? (default false)
    # logger:   Logger (optional)
    constructor: (@opts) ->
        super useHeartbeat:false

        @url = @opts.url

        debug "ProxySource created for #{@url}"

        @isFallback     = @opts.fallback or false

        @defaultHeaders = @opts.headers or "user-agent": "StreamMachine 0.1.0"

        @connected      = false
        @framesPerSec   = null

        @connected_at   = null

        @_in_disconnect = false

        # connection drop handling
        # (FIXME: bouncing not yet implemented)
        @_maxBounces    = 10
        @_bounces       = 0
        @_bounceInt     = 5

        @StreamTitle    = null
        @StreamUrl      = null

        @d = domain.create()

        @d.on "error", (err) =>
            @_niceError err

        @d.run =>
            @connect()

    #----------

    _niceError: (err) =>
        debug "Caught error: #{err}", err.stack
        nice_err = switch err.syscall
            when "getaddrinfo"
                "Unable to look up DNS for Icecast proxy"
            when "connect"
                "Unable to connect to Icecast proxy. Connection Refused"
            else
                "Error making connection to Icecast proxy"

        @log?.error "ProxySource encountered an error: #{nice_err}", err

    #----------

    status: =>
        source:         @TYPE?() ? @TYPE
        connected:      @connected
        url:            @url
        streamKey:      @streamKey
        uuid:           @uuid
        isFallback:     @isFallback
        last_ts:        @last_ts
        connected_at:   @connected_at


    #----------

    connect: =>
        @createParser()

        debug "Begin connection to Icecast from #{@url}"

        url_opts = url.parse @url
        url_opts.headers = _.clone @defaultHeaders

        @last_ts = null
        @chunker.resetTime new Date()

        @ireq = Icy.get url_opts, (ice) =>
            debug "Connected to Icecast from #{@url}"

            if ice.statusCode == 302
                @url = ice.headers.location

            @icecast = ice

            @icecast.once "end", =>
                debug "Received Icecast END event"
                @reconnect()

            @icecast.once "close", =>
                debug "Received Icecast CLOSE event"
                @reconnect()

            @icecast.on "metadata", (data) =>
                debug "Received Icecast METADATA event"

                unless @_in_disconnect
                    meta = Icy.parse(data)

                    if meta.StreamTitle
                        @StreamTitle = meta.StreamTitle

                    if meta.StreamUrl
                        @StreamUrl = meta.StreamUrl

                    @emit "metadata", StreamTitle:@StreamTitle||"", StreamUrl:@StreamUrl||""

            # incoming -> Parser
            @icecast.on "data", (chunk) =>
                @parser.write chunk

            # return with success
            @connected = true
            @connected_at = new Date()
            @emit "connect"

            setTimeout @checkStatus, 30000

        @ireq.once "error", (err) =>
            debug "Gor icecast stream error #{err}, reconnecting"
            @_niceError err
            @reconnect()

        # outgoing -> Stream
        @on "_chunk", @broadcastData

    #----------

    broadcastData: (chunk) =>
        debug "Received chunk from parser (#{chunk.ts})"
        @last_ts = chunk.ts
        @emit "data", chunk

    #----------

    checkStatus: =>
        if not @connected
            debug "Check status: not connected, skipping"
            return

        debug "Check status: last chunk timestamp is #{@last_ts}"

        unless @last_ts
            return setTimeout @checkStatus, 5000

        if moment(@last_ts).isBefore(moment().subtract(1, "minutes"))
            debug "Check status: last chunk timestamp is older than 1 minute ago, reconnecting"
            return @reconnect()

        setTimeout @checkStatus, 30000

    #----------

    reconnect: =>
        return unless @connected

        msWaitToConnect = 5000
        debug "Reconnect to Icecast source from #{@url} in #{msWaitToConnect}ms"

        @connected = false

        # Clean proxy listeners
        @removeListener "_chunk", @broadcastData

        # Clean icecast
        @ireq?.end()
        @ireq?.res?.client.destroy()
        @icecast?.removeAllListeners()
        @icecast = null
        @ireq = null

        @parser = null
        @chunker = null

        setTimeout @connect, msWaitToConnect
