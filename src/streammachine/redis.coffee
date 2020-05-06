_       = require 'underscore'
Redis   = require 'redis'
Url     = require "url"
nconf   = require "nconf"
debug   = require("debug")("sm:redis")

module.exports = class RedisManager extends require('events').EventEmitter
    DefaultOptions:
        server: "redis://localhost:6379"
        key:    "StreamMachine"

    constructor: (opts) ->
        super()

        @options = _.defaults opts, @DefaultOptions

        debug "init redis with #{@options.server}"
        info = Url.parse @options.server
        @client = Redis.createClient info.port||6379, info.hostname

        @client.once "ready", =>
            rFunc = =>
                @_connected = true
                @emit "connected", @client

                # see if there's a config to load
                #@_config()

            if info.pathname && info.pathname != "/"
                # see if there's a database number in the path
                db = Number(info.pathname.substr(1))

                if isNaN(db)
                    throw new Error "Invalid path in Redis URI spec. Expected db number, got '#{info.pathname.substr(1)}'"

                debug "Redis connecting to DB #{db}"
                @client.select db, (err) =>
                    throw new Error "Redis DB select error: #{err}" if err
                    @_db = db

                    rFunc()
            else
                @_db = 0
                debug "Redis using DB 0."
                rFunc()


    #----------

    prefixedKey: (key) ->
        if @options.key
            "#{@options.key}:#{key}"
        else
            key

    #----------

    once_connected: (cb) ->
        if @_connected
            cb?(@client)
        else
            @once "connected", cb
