_ = require "underscore"
uuid = require "node-uuid"

debug = require('debug')('sm:outputs:base')

module.exports = class BaseOutput extends require("events").EventEmitter
    constructor: (output) ->
        @disconnected = false

        # turn @opts into @client

        @client = output:output
        @socket = null

        if @opts.req && @opts.res
            # -- startup mode...  sending headers -- #

            @client.ip          = @opts.req.ip

            #@client.ip          = @opts.req.connection.remoteAddress
            @client.path        = @opts.req.url
            @client.ua          = _.compact([@opts.req.param("ua"),@opts.req.headers?['user-agent']]).join(" | ")
            @client.user_id     = @opts.req.user_id

            @client.pass_session    = true

            @client.session_id      =
                if a_session = @opts.req.headers?['x-playback-session-id']
                    @client.pass_session = false
                    a_session

                else if @opts.req.param("session_id")
                    # use passed-in session id
                    @opts.req.param("session_id")

                else
                    # generate session id
                    uuid.v4()

            @socket = @opts.req.connection

        else
            @client = @opts.client
            @socket = @opts.socket

    #----------

    disconnect: (cb) ->
        if !@disconnected
            @disconnected = true
            @emit "disconnect"
            cb?()