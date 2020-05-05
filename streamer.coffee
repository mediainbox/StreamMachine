process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';

if !process.env.NEW_RELIC_APP_NAME ||!process.env.NEW_RELIC_LICENSE_KEY
    console.log('Skipping NewRelic, missing NEW_RELIC_APP_NAME or NEW_RELIC_LICENSE_KEY env vars')
else
    console.log('Loading NewRelic')
    require('newrelic')


require('@google-cloud/trace-agent').start
    projectId: process.env.GCLOUD_PROJECT
    keyFilename: process.env.GCLOUD_KEY_FILENAME

require('@google-cloud/debug-agent').start
    projectId: process.env.GCLOUD_PROJECT
    keyFilename: process.env.GCLOUD_KEY_FILENAME

_ = require "underscore"
nconf = require "nconf"
request = require "request"
debug = require("debug") "sm:master:streamer"

class Streamer
    constructor: (@config) ->
        @mode = nconf.get("mode") or "standalone"
        debug "Created as #{@mode}"

    #----------

    initialize: () ->
        @getRadio (radio) =>
            @ping()
            @createStreamMachine radio

    #----------

    getRadio: (callback) ->
        request.get(@config.uri,
            json: true,
            qs: ping: @mode
        , (error, response, body) =>
            if error
                debug error
                return @retry callback
            if not body
                debug "No radio available"
                return @retry callback
            callback body
        )

    #----------

    retry: (callback) ->
        setTimeout () =>
            debug "Retry"
            @getRadio callback
        , @config.ping / 2

    #----------

    createStreamMachine: (@radio) ->
        # There are three potential modes of operation:
        # 1) Standalone -- One server, handling boths streams and configuration
        # 2) Master -- Central server in a master/slave setup. Does not handle any streams
        #    directly, but hands out config info to slaves and gets back logging.
        # 3) Slave -- Connects to a master server for stream information.  Passes back
        #    logging data. Offers up stream connections to clients.
        _.defaults @radio.options, @getStreamMachine().Defaults
        switch @mode
            when "master"
                new (@getStreamMachine()).MasterMode @radio.options
            when "slave"
                new (@getStreamMachine()).SlaveMode @radio.options
            else
                new (@getStreamMachine()).StandaloneMode @radio.options

    #----------

    getStreamMachine: () ->
        @streamMachine = @streamMachine or require "./src/streammachine"
        @streamMachine

    #----------

    ping: () ->
        setTimeout () =>
            debug "Ping"
            request.put @config.uri,
                qs: ping: @mode, name: @radio.name
            , () =>
                @ping()
        , @config.ping

    #----------

#----------

nconf.env().argv()
nconf.file file: nconf.get("config") || nconf.get("CONFIG") || "/etc/streammachine.conf"

# -- Debugging -- #
# These next two sections are for debugging and use tools that are not included
# as dependencies.
if nconf.get("enable-heapdump")
    console.log "ENABLING HEAPDUMP (trigger via USR2)"
    require("heapdump")
if nconf.get("heapdump-interval")
    console.log "ENABLING PERIODIC HEAP DUMPS"
    heapdump = require "heapdump"
    setInterval =>
        file = "/tmp/streammachine-#{process.pid}-#{Date.now()}.heapsnapshot"
        heapdump.writeSnapshot file, (err) =>
            if err
                console.error err
            else
                console.error "Wrote heap snapshot to #{file}"
    , Number(nconf.get("heapdump-interval")) * 1000
# -- -- #

streamer = new Streamer nconf.get()
streamer.initialize()
