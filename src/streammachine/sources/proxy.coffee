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

        @log?.debug "ProxySource created for #{@url}"

        @isFallback     = @opts.fallback || false

        @connected      = false
        @framesPerSec   = null

        @last_ts        = null
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

    _niceError: (err) ->
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

    status: ->
        source:         @TYPE?() ? @TYPE
        connected:      @connected
        url:            @url
        streamKey:      @streamKey
        uuid:           @uuid
        isFallback:     @isFallback
        last_ts:        @last_ts
        connected_at:   @connected_at


    #----------

    connect: ->
        @log?.debug "connecting to #{@url}"

        url_opts = url.parse @url
        url_opts.headers = "user-agent":"StreamMachine 0.1.0"

        debug "Connecting to #{@url}"

        _reconnect = _.once =>
            unless @_in_disconnect
                debug "Engaging reconnect logic"
                setTimeout ( => @connect() ), 1000

                @log?.debug "Lost or failed to make connection to #{@url}. Retrying in one second."
                @connected = false

                # unpipe everything
                @icecast?.removeAllListeners()
                @icecast = null

        ireq = Icy.get url_opts, (ice) =>
            if ice.statusCode == 302
                @url = ice.headers.location
            @icecast = ice

            @icecast.once "end", =>
                debug "Got end event"
                _reconnect()

            @icecast.once "close", =>
                debug "Got close event"
                _reconnect()

            @icecast.on "metadata", (data) =>
                unless @_in_disconnect
                    meta = Icy.parse(data)

                    if meta.StreamTitle
                        @StreamTitle = meta.StreamTitle

                    if meta.StreamUrl
                        @StreamUrl = meta.StreamUrl

                    @emit "metadata", StreamTitle:@StreamTitle||"", StreamUrl:@StreamUrl||""

            # incoming -> Parser
            @icecast.on "data", (chunk) => @parser.write chunk

            # return with success
            @connected = true
            @connected_at = new Date()
            @emit "connect"

            _checkStatus = () =>
                debug "Checking last_ts: #{@last_ts}"
                return unless @connected and not @_in_disconnect
                unless @last_ts
                    return setTimeout _checkStatus, 5000
                if moment(@last_ts).isBefore(moment().subtract(1, "minutes"))
                    return _reconnect()
                setTimeout _checkStatus, 30000
            setTimeout _checkStatus, 30000

        ireq.once "error", (err) =>
            @_niceError err
            _reconnect()

        # outgoing -> Stream
        @on "_chunk", (chunk) =>
            @last_ts = chunk.ts
            @emit "data", chunk

    #----------

    disconnect: ->
        @_in_disconnect = true

        if @connected
            @icecast?.removeAllListeners()
            @parser.removeAllListeners()
            @removeAllListeners()

            @icecast.end()

            @parser = null
            @icecast = null

            @log?.debug "ProxySource disconnected."

            @removeAllListeners()
