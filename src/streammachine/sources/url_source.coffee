Icy     = require 'icy'
util    = require 'util'
url     = require 'url'
domain  = require "domain"
moment  = require "moment"
_       = require "underscore"

module.exports = class UrlSource extends require("./base/base_source")
    TYPE: -> "Proxy (#{@url})"

    # opts should include:
    # format:   Format for Parser (aac or mp3)
    # url:      URL for original stream
    # fallback: Should we set the isFallback flag? (default false)
    # logger:   Logger (optional)
    constructor: (opts) ->
        super opts, useHeartbeat:false

        @url = @opts.url

        @logger = @opts.logger.child({
            component: "source_url:#{opts.key}"
        })
        @logger.debug "url source created for #{@url}"

        @isFallback     = @opts.fallback or false

        @defaultHeaders = @opts.headers or "user-agent": "StreamMachine 0.1.0"

        @connected      = false
        @framesPerSec   = null
        @connected_at   = null
        @chunksCount = 0

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
        @logger.debug "Caught error: #{err}", err.stack
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

        @logger.debug "connect to Icecast on #{@url}"

        url_opts = url.parse @url
        url_opts.headers = _.clone @defaultHeaders

        @last_ts = null
        @chunker.resetTime new Date()

        @ireq = Icy.get url_opts, (ice) =>
            @logger.debug "connected to Icecast at #{@url}"

            if ice.statusCode == 302
                @url = ice.headers.location

            @icecast = ice

            @icecast.once "end", =>
                @logger.debug "Received Icecast END event"
                @reconnect()

            @icecast.once "close", =>
                @logger.debug "Received Icecast CLOSE event"
                @reconnect()

            @icecast.on "metadata", (data) =>
                @logger.debug "Received Icecast METADATA event"

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
            @logger.debug "Got icecast stream error #{err}, reconnecting"
            @_niceError err
            @reconnect(true)

        # outgoing -> Stream
        @on "_chunk", @broadcastData

        @logChunk = _.throttle(@_logChunk.bind(this), 30000)
        @on "_chunk", @logChunk

    #----------

    broadcastData: (chunk) =>
        @chunksCount++
        @last_ts = chunk.ts
        @emit "data", chunk

    #----------

    _logChunk: (chunk) =>
        @logger.debug "received chunk from parser (time: #{chunk.ts.toISOString().substr(11)}, total: #{@chunksCount})"


    #----------

    checkStatus: =>
        if not @connected
            @logger.debug "status check: not connected, skipping"
            return

        @logger.debug "status check: last chunk time is #{@last_ts.toISOString().substr(11)}"

        unless @last_ts
            return setTimeout @checkStatus, 5000

        if moment(@last_ts).isBefore(moment().subtract(1, "minutes"))
            @logger.debug "status check: last chunk timestamp is older than 1 minute ago, reconnecting"
            return @reconnect()

        setTimeout @checkStatus, 30000

    #----------

    reconnect: (ignoreConnectionStatus = false) =>
        # Ignore reconnection if there is an active connection or the "ignore status" flag given is false
        if !@connected && !ignoreConnectionStatus
          return

        msWaitToConnect = 5000
        @logger.debug "Reconnect to Icecast source from #{@url} in #{msWaitToConnect}ms"

        @connected = false

        # Clean proxy listeners
        @chunksCount = 0
        @removeListener "_chunk", @broadcastData
        @removeListener "_chunk", @logChunk

        # Clean icecast
        @ireq?.end()
        @ireq?.res?.client.destroy()
        @icecast?.removeAllListeners()
        @icecast = null
        @ireq = null

        @parser = null
        @chunker = null

        setTimeout @connect, msWaitToConnect
