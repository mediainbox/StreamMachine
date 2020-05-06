winston = require "winston"
WinstonCommon = require "winston/lib/winston/common"
LoggingWinston = require('@google-cloud/logging-winston').LoggingWinston
fs          = require "fs"
path        = require "path"
strftime    = require("prettydate").strftime
Transport = require('winston-transport')

class DebugTransport extends winston.Transport
    name: "debug"
    log: (level,msg,meta,callback) ->
        debug "#{level}: #{msg}", meta
        callback null, true

#----------

class ConsoleTransport extends winston.transports.Console
    constructor: (@opts) ->
        super @opts
        @ignore_levels = (@opts.ignore||"").split(",")

    log: (level, msg, meta, callback) ->
        if @silent
            return callback null, true

        if @ignore_levels.indexOf(level) != -1
            return callback null, true

        # extract prefix elements from meta
        prefixes = []
        for k in ['pid','mode','component']
            if meta[k]
                prefixes.push meta[k]
                delete meta[k]

        output = WinstonCommon.log
            colorize:    this.colorize
            json:        this.json
            level:       level
            message:     msg
            meta:        meta
            stringify:   this.stringify
            timestamp:   this.timestamp
            prettyPrint: this.prettyPrint
            raw:         this.raw
            label:       this.label

        if prefixes.length > 0
            output = prefixes.join("/") + " -- " + output

        if level == 'error' || level == 'debug'
            process.stderr.write output + "\n"
        else
            process.stdout.write output + "\n"

        @emit "logged"
        callback null, true

#----------

class W3CLogger extends winston.Transport
    name: "w3c"

    constructor: (options) ->
        super(options)

        @options = options

        @_opening   = false
        @_file      = null
        @_queue = []

        process.addListener "SIGHUP", =>
            console.log "w3c reloading log file"
            @close => @open()

#----------

    log: (level,msg,meta,cb) ->
        # unlike a normal logging endpoint, we only care about our request entries
        if level == @options.level
        # for a valid w3c log, level should == "request", meta.
            logline = "#{meta.ip} #{strftime(new Date(meta.time),"%F %T")} #{meta.path} 200 #{escape(meta.ua)} #{meta.bytes} #{meta.seconds}"

            @_queue.push logline
            @_runQueue()

#----------

    _runQueue:  ->
        if @_file
            # we're open, so do a write...
            if @_queue.length > 0
                line = @_queue.shift()
                @_file.write line+"\n", "utf8", =>
                    @_runQueue if @_queue.length > 0

        else
            @open (err) => @_runQueue()

#----------

    open: (cb) ->
        if @_opening
            console.log "W3C already opening... wait."
            # we're already trying to open.  return an error so we queue the message
            return false

        console.log "W3C opening log file."

        # note that we're opening, and also set a timeout to make sure
        # we don't get stuck
        @_opening = setTimeout =>
            console.log "Failed to open w3c log within one second."
            @_opening = false
            @open(cb)
        , 1000

        # is this a new file or one that we're just re-opening?
        initFile = true
        if fs.existsSync(@options.filename)
            # file exists...  see if there's anything in it
            stats = fs.statSync(@options.filename)

            if stats.size > 0
                # existing file...  don't write headers, just open so we can
                # start appending
                initFile = false

        @_file = fs.createWriteStream @options.filename, flags:(if initFile then "w" else "r+")

        @_file.once "open", (err) =>
            console.log "w3c log open with ", err

            _clear = =>
                console.log "w3c open complete"
                clearTimeout @_opening if @_opening
                @_opening = null
                cb?()

            if initFile
                # write our initial w3c lines before we return
                @_file.write "#Software: StreamMachine\n#Version: 0.2.9\n#Fields: c-ip date time cs-uri-stem c-status cs(User-Agent) sc-bytes x-duration\n", "utf8", =>
                    _clear()

            else
                _clear()

#----------

    close: (cb) ->
        @_file?.end null, null, =>
            console.log "W3C log file closed."
        @_file = null

#----------

    flush: ->
        @_runQueue()

#----------

class SocketLogger extends winston.Transport
    name: "socket"

    constructor: (@io,opts) ->
        super(opts)

    log: (level,msg,meta,cb) ->
        @io.log level:level, msg:msg, meta:meta
        cb?()


module.exports =
    DebugTransport: DebugTransport
    ConsoleTransport: ConsoleTransport
    W3CLogger: W3CLogger
    SocketLogger: SocketLogger
