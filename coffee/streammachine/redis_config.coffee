Redis = require 'redis'
Url = require "url"
EventEmitter = require('events').EventEmitter

debug = require("debug")("sm:redis_config")

module.exports = class RedisConfig extends EventEmitter
    constructor: (@redis) ->
        process.nextTick =>
            @_config()

    #----------

    _config: ->
        @redis.once_connected (client) =>
            debug "Querying config from Redis"
            client.get @redis.prefixedKey("config"), (err, reply) =>
                if reply
                    config = JSON.parse(reply.toString())
                    debug "Got redis config of ", config
                    @emit "config", config
                else
                    @emit "config", null

     #----------

     _update: (config,cb) ->
         @redis.once_connected (client) =>
             debug "Saving configuration to Redis"

             client.set @redis.prefixedKey("config"), JSON.stringify(config), (err,reply) =>
                if err
                    debug "Redis: Failed to save updated config: #{err}"
                    cb err
                else
                    debug "Set config to ", config, reply
                    cb null
