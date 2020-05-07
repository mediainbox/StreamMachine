###
require('@google-cloud/trace-agent').start
    projectId: process.env.GCLOUD_PROJECT
    keyFilename: process.env.GCLOUD_KEY_FILENAME
###

process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';

if process.env.NEW_RELIC_APP_NAME && process.env.NEW_RELIC_LICENSE_KEY
    console.log('[integrations] loading NewRelic')
    require('newrelic')


#require('@google-cloud/debug-agent').start
#    projectId: process.env.GCLOUD_PROJECT
#    keyFilename: process.env.GCLOUD_KEY_FILENAME

_ = require "lodash"
nconf = require "nconf"
request = require "request"
debug = require("debug") "sm:streamer"

StreamMachine = require "./src/streammachine"

class Streamer
    constructor: (@config) ->

    #----------

    initialize: () ->
        @readConfig (config) =>
            @ping()
            @createStreamMachine config

    #----------

    readConfig: (callback) ->
        if @config.client
            debug "using local config: #{@config.config}"
            callback @config
            return

        if !@config.uri
            throw new Error('No remote config URL supplied in config file')

        debug "fetch remove config from #{@config.uri}"
        request.get(@config.uri,
            json: true,
            qs: ping: @mode
        , (error, response, body) =>
            if error
                debug error
                debug "Error ocurred, retrying"
                return @retry callback
            if not body
                debug "No radio available, retrying"
                return @retry callback
            debug "Fetched radio config successfully"
            callback body
        )

    #----------

    retry: (callback) ->
        setTimeout () =>
            debug "Retry"
            @readConfig callback
        , @config.ping / 2

    #----------

    createStreamMachine: (@config) ->
        # There are three potential modes of operation:
        # 1) Standalone -- One server, handling boths streams and configuration
        # 2) Master -- Central server in a master/slave setup. Does not handle any streams
        #    directly, but hands out config info to slaves and gets back logging.
        # 3) Slave -- Connects to a master server for stream information.  Passes back
        #    logging data. Offers up stream connections to clients.
        _.defaults @config.options, StreamMachine.Defaults
        @mode = nconf.get("mode") or @config.options.mode

        switch @mode
            when "master"
                new StreamMachine.Modes.MasterMode @config.options
            when "slave"
                new StreamMachine.Modes.SlaveMode @config.options
            else
                new StreamMachine.Modes.StandaloneMode @config.options

    #----------

    ping: () ->
        setTimeout () =>
            _.throttle(() => debug "Ping", 10000)
            request.put @config.uri,
                qs: ping: @mode, name: @config.name
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
