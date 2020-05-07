net     = require "net"
express = require "express"

IcecastSource = require "../../sources/icecast_source"
IcyParser = require "./icy_parser"

module.exports = class SourceIn extends require("events").EventEmitter
    constructor: (@ctx) ->
        super()

        @config = @ctx.config
        @port = @ctx.config.port
        @behind_proxy = @ctx.config.behind_proxy

        @logger = @ctx.logger.child({
            component: "source_in"
        })

        # create our server
        @server = net.createServer (c) => @_connection(c)

    listen: (port=@port) ->
        @logger.info "source_in listening on port #{port}"
        @server.listen port

    _connection: (sock) =>
        @logger.debug "Incoming source attempt."

        # immediately attach an error listener so that a connection reset
        # doesn't crash the whole system
        sock.on "error", (err) =>
            @logger.debug "Source socket errored with #{err}"

        # set a timeout for successful / unsuccessful parsing
        timer = setTimeout =>
            @logger.debug "Incoming source connection failed to validate before timeout."

            sock.write "HTTP/1.0 400 Bad Request\r\n"
            sock.end "Unable to validate source connection.\r\n"
        , 2000

        # -- incoming data -- #

        parser = new IcyParser IcyParser.REQUEST

        readerF = =>
            parser.execute d while d = sock.read()
        sock.on "readable", readerF

        parser.once "invalid", =>
            # disconnect our reader
            sock.removeListener "readable", readerF

            # close the connection
            sock.end "HTTP/1.0 400 Bad Request\n\n"

        parser.once "headersComplete", (headers) =>
            # cancel our timeout
            clearTimeout timer

            if /^(ICE|HTTP)$/.test(parser.info.protocol) && /^(SOURCE|PUT)$/.test(parser.info.method)
                @logger.debug "ICY SOURCE attempt.", url:parser.info.url
                @_trySource sock, parser.info

                # get out of the way
                sock.removeListener "readable", readerF

    _trySource: (sock,info) =>
        _authFunc = (mount) =>
            # first, make sure the authorization header contains the right password
            @logger.debug "Trying to authenticate ICY source for #{mount.key}"
            if info.headers.authorization && @_authorize(mount.password,info.headers.authorization)
                sock.write "HTTP/1.0 200 OK\n\n"
                @logger.debug "ICY source authenticated for #{mount.key}."

                # if we're behind a proxy, look for the true IP address
                source_ip = sock.remoteAddress
                if @behind_proxy && info.headers['x-forwarded-for']
                    source_ip = info.headers['x-forwarded-for']

                # now create a new source
                source = new IcecastSource
                    format:     mount.opts.format
                    sock:       sock
                    headers:    info.headers
                    logger:     mount.log
                    source_ip:  source_ip

                mount.addSource source

            else
                @logger.debug "ICY source failed to authenticate for #{mount.key}."
                sock.write "HTTP/1.0 401 Unauthorized\r\n"
                sock.end "Invalid source or password.\r\n"


        # -- source request... is the endpoint one that we recognize? -- #

        if Object.keys(@ctx.master.source_mounts).length > 0 && m = ///^/(#{Object.keys(@ctx.master.source_mounts).join("|")})///.exec info.url
            @logger.debug "Incoming source matched mount: #{m[1]}"
            mount = @ctx.master.source_mounts[ m[1] ]
            _authFunc mount

        else
            @logger.debug "ICY source attempted to connect to bad URL.", url:info.url

            sock.write "HTTP/1.0 401 Unauthorized\r\n"
            sock.end "Invalid source or password.\r\n"

    _tmp: ->
        if ///^/admin/metadata///.match req.url
            res.writeHead 200, headers
            res.end "OK"

        else
            res.writeHead 400, headers
            res.end "Invalid method #{res.method}."

    #----------

    _authorize: (stream_passwd,header) ->
        # split the auth type from the value
        [type,value] = header.split " "

        if type.toLowerCase() == "basic"
            value = Buffer.from(value, 'base64').toString('ascii')
            [user,pass] = value.split ":"

            if pass == stream_passwd
                true
            else
                false
        else
            false
