RPC = require "ipc-rpc"
_ = require "underscore"

Logger  = require "../logger"
Slave   = require "./"

debug = require("debug")("sm:slave:slave_worker")

# TEMP
process.on "uncaughtException", (err) ->
    console.error "err is: #{err}"
    console.error "err stack is: ", err.stack

module.exports = class SlaveWorker
    constructor: ->
        @_config = null

        @_configured    = false
        @_loaded        = false

        debug "Init for SlaveWorker"

        # -- Set up RPC -- #

        new RPC process, functions:
            status: (msg,handle,cb) =>
                @slave._streamStatus cb

            #---

            # Accept an incoming connection attempt
            connection: (msg,sock,cb) =>
                sock.allowHalfOpen = true
                @slave.server.handle sock
                cb null, "OK"

            # Accept a listener that we should now start serving
            land_listener: (msg,handle,cb) =>
                @slave.landListener msg, handle, cb

            #---

            # Request to send all our listeners to the main slave process,
            # probably so that it can whack us
            send_listeners: (msg,handle,cb) =>
                @slave.ejectListeners (obj,h,lcb) =>
                    @_rpc.request "send_listener", obj, h, (err) =>
                        lcb()

                , (err) =>
                    cb err

            #---

            # Request asking that we shut down...
            shutdown: (msg,handle,cb) =>
                # we ask the slave instance to shut down. It in turn asks us
                # to distribute its listeners.

                if @slave
                    @slave._shutdown (err) =>
                        cb err
                else
                    # we haven't gotten far enough... just exit
                    cb null
                    setTimeout =>
                        process.exit()
                    , 100

        , (err,rpc) =>
            @_rpc = rpc

            # We're initially loaded via no config. At this point, we need
            # to request config from the main slave process.
            debug "Requesting slave config over RPC"
            @_rpc.request "config", (err,obj) =>
                if err
                    console.error "Error loading config: #{err}"
                    process.exit(1)

                debug "Slave config received"

                @_config = obj

                if @_config["enable-webkit-devtools-slaveworker"]
                    console.log "ENABLING WEBKIT DEVTOOLS IN SLAVE WORKER"
                    agent = require("webkit-devtools-agent")
                    agent.start()

                @log = (new Logger @_config.log).child mode:"slave_worker", pid:process.pid
                @log.debug("SlaveWorker initialized")

                # -- Create our Slave Instance -- #

                debug "Creating slave instance"
                @slave = new Slave _.extend(@_config, logger:@log), @

                # -- Communicate Config Back to Slave -- #

                # we watch the slave instance, and communicate its config event back
                # to the main slave

                @slave.once_configured =>
                    debug "Slave instance says it is configured"
                    @_configured = true
                    @_rpc.request "worker_configured", (err) =>
                        if err
                            @log.error "Error sending worker_configured: #{err}"
                        else
                            @log.debug "Controller ACKed that we're configured."
                            debug "Slave controller ACKed our config"

                # -- Communicate Rewinds Back to Slave -- #

                # when all rewinds are loaded, pass that word on to our main slave

                @slave.once_rewinds_loaded =>
                    debug "Slave instance says rewinds are loaded"
                    @_loaded = true
                    @_rpc.request "rewinds_loaded", (err) =>
                        if err
                            @log.error "Error sending rewinds_loaded: #{err}"
                        else
                            @log.debug "Controller ACKed that our rewinds are loaded."
                            debug "Slave controller ACKed that our rewinds are loaded"

    #----------

    # A slave worker instance can request to shut down either
    # because it got a request to do so from the master, or
    # because of some sort of a fault condition in the worker.

    # To shut down, we need to transfer the worker instance's
    # listeners to a different worker.

    shutdown: (cb) ->
        @log.info "Triggering listener ejection after shutdown request."
        @slave.ejectListeners (obj,h,lcb) =>
            @_rpc.request "send_listener", obj, h, (err) =>
                lcb()

        , (err) =>
            # now that we're finished transferring listeners, we need to
            # go ahead and shut down
            @log.info "Listener ejection completed. Shutting down..."

            cb err

            setTimeout =>
                @log.info "Shutting down."
                process.exit(1)
            , 300
