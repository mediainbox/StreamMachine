_ = require "underscore"
StackdriverLogging = require('@google-cloud/logging-winston').LoggingWinston
customTransports = require "./transports";

winston = require "winston"
{ combine, timestamp, label, prettyPrint } = winston.format;

debug = require("debug")("sm:logger")

module.exports = createLogger: (config) ->
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

    debug "create logger (mode: #{config.mode}, env: #{config.env})"

    transports = []

    # -- debug -- #

    transports.push new customTransports.DebugTransport

    # -- stdout -- #

    if config.stdout
        debug "adding console transport"
        transports.push new winston.transports.Console(
            colorize: true,
            prettyPrint: true,
            timestamp: true
        )

    ###
    transports.push new customTransports.ConsoleTransport
        level:      config.stdout?.level        || "debug"
        colorize:   config.stdout?.colorize     || false
        timestamp:  config.stdout?.timestamp    || false
        ignore:     config.stdout?.ignore       || ""
    ###

    # -- JSON -- #

    if config.json?.file
        debug "Setting up JSON logger with ", config.json
        transports.push new (winston.transports.File)
            level:      config.json.level || "interaction"
            timestamp:  true
            filename:   config.json.file
            json:       true
            options:
                flags: 'a'
                highWaterMark: 24


    # -- Stackdriver -- #

    if config.stackdriver? || 1
        debug "adding stackdriver transport"
        transports.push new StackdriverLogging(
            name: "stackdriver"
            logname: 'stream_machine'
            logName: 'stream_machine'
            prefix: config.mode
            labels:
                    mode: config.mode,
                    env: config.env
        )


    # create a winston logger for this instance
    logger = winston.createLogger
        level: 'debug'
        levels: winston.config.syslog.levels
        transports: transports
        #levels:@CustomLevels
        #, rewriters:[@RequestRewriter]

    winston.addColors(winston.config.syslog.levels)

    return logger

    #----------

    # connect to our events and proxy interaction and request events through
    # to a master server over WebSockets
    proxyToMaster: (sock) ->
        @logger.remove(@logger.transports['socket']) if @logger.transports['socket']
        @logger.add (new Logger.SocketLogger sock, level:"interaction"), {}, true if sock

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
            @child = (opts={}) -> new Logger.Child(@parent,_.extend({},@opts,opts))

        proxyToMaster: (sock) ->
            @parent.proxyToMaster(sock)

    #----------
