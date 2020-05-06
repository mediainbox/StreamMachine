_ = require "underscore"
winston = require "winston"
LoggingWinston = require('@google-cloud/logging-winston').LoggingWinston
customTransports = require "./transports";

fs          = require "fs"
path        = require "path"

debug = require("debug")("sm:logger")

module.exports = class LogController
    CustomLevels:
        error:          80
        alert:          75
        event:          70
        info:           60
        request:        40
        interaction:    30
        minute:         30
        debug:          10
        silly:          5

    constructor: (config, mode, env) ->
        console.log "[logging] configure logger, mode: #{mode}, env: #{env}"

        transports = []

        # -- debug -- #

        transports.push new customTransports.DebugTransport level:"silly"

        # -- stdout -- #

        if config.stdout
            console.log "[logging] adding console transport"
            transports.push new customTransports.ConsoleTransport
                level:      config.stdout?.level        || "debug"
                colorize:   config.stdout?.colorize     || false
                timestamp:  config.stdout?.timestamp    || false
                ignore:     config.stdout?.ignore       || ""

        # -- JSON -- #

        if config.json?.file
            console.log "Setting up JSON logger with ", config.json
            transports.push new (winston.transports.File)
                level:      config.json.level || "interaction"
                timestamp:  true
                filename:   config.json.file
                json:       true
                options:
                    flags: 'a'
                    highWaterMark: 24

        # -- W3C -- #

        if config.w3c?.file
            # set up W3C-format logging
            transports.push new customTransports.W3CLogger
                level:      config.w3c.level || "request"
                filename:   config.w3c.file


        # -- Stackdriver -- #

        if config.stackdriver? || 1
            console.log "[logging] adding stackdriver transport"
            transports.push new LoggingWinston(
                name: "stackdriver"
                logname: 'stream_machine'
                logName: 'stream_machine'
                prefix: mode
                labels:
                        mode: mode,
                        env: env

            )


        # create a winston logger for this instance
        @logger = new (winston.Logger) transports:transports, levels:@CustomLevels #, rewriters:[@RequestRewriter]
        @logger.extend(@)

    #----------

    # returns a logger that will automatically merge in the given data
    child: (opts={}) -> new LogController.Child(@,opts)

    #----------

    # connect to our events and proxy interaction and request events through
    # to a master server over WebSockets
    proxyToMaster: (sock) ->
        @logger.remove(@logger.transports['socket']) if @logger.transports['socket']
        @logger.add (new LogController.SocketLogger sock, level:"interaction"), {}, true if sock

    #----------

    class @Child
        constructor: (@parent,@opts) ->
            _(['log', 'profile', 'startTimer'].concat(Object.keys(@parent.logger.levels))).each (k) =>
                @[k] = (args...) =>
                    if _.isObject(args[args.length-1])
                        args[args.length-1] = _.extend {}, args[args.length-1], @opts
                    else
                        args.push _.clone(@opts)

                    @parent[k].apply @, args

            @logger = @parent.logger
            @child = (opts={}) -> new LogController.Child(@parent,_.extend({},@opts,opts))

        proxyToMaster: (sock) ->
            @parent.proxyToMaster(sock)

    #----------
