_       = require "underscore"
express = require "express"
nconf   = require "nconf"

Logger  = require "../logger"
Master  = require "../master"
Slave   = require "../slave"

debug = require("debug")("sm:modes:standalone")

module.exports = class StandaloneMode extends require("./base_mode")
    MODE: "StandAlone"
    constructor: (@opts,cb) ->
        super(opts)

        # -- Set up logging -- #

        @log = (new Logger @opts.log).child pid:process.pid
        @log.debug("StreamMachine standalone initialized.")

        process.title = "StreamMachine"

        @streams = {}

        # -- Set up master and slave -- #

        @master = new Master _.extend {}, @opts, logger:@log.child(mode:"master")
        @slave  = new Slave _.extend {}, @opts, logger:@log.child(mode:"slave")

        # -- Set up our server(s) -- #

        @server = express()
        @api_server = null
        @api_handle = null

        if @opts.api_port
            @api_server = express()
            @api_server.use "/api", @master.api.app

        else
            @log.error "USING API ON MAIN PORT IS UNSAFE! See api_port documentation."
            @server.use "/api", @master.api.app

        @server.use @slave.server.app

        # -- set up RPC -- #

        if process.send?
            @_rpc = new RPC process, functions:
                OK: (msg,handle,cb) ->
                    cb null, "OK"

                standalone_port: (msg,handle,cb) =>
                    cb null, @handle?.address().port||"NONE"

                source_port: (msg,handle,cb) =>
                    cb null, @master.sourcein?.server.address()?.port||"NONE"

                api_port: (msg,handle,cb) =>
                    cb null, api_handle?.address()?.port||"NONE"

                stream_listener: (msg,handle,cb) =>
                    @slave.landListener msg, handle, cb

                config: (config,handle,cb) =>
                    @master.configure config, (err) =>
                        cb err, @master.config()

                status: (msg,handle,cb) =>
                    @status cb

        # -- Proxy data events from master -> slave -- #

        @master.on "streams", (streams) =>
            debug "Standalone saw master streams event"
            @slave.once "streams", =>
                debug "Standalone got followup slave streams event"
                for k,v of @master.streams
                    debug "Checking stream #{k}"

                    if @slave.streams[k]?
                        debug "Mapping master -> slave for #{k}"
                        @log.debug "mapping master -> slave on #{k}"
                        @slave.streams[k].useSource v if !@slave.streams.source
                    else
                        @log.error "Unable to map master -> slave for #{k}"

            @slave.configureStreams @master.config().streams

        @log.info "Standalone is listening on port #{@opts.port}"

        # -- Handoff? -- #

        if nconf.get("handoff")
            @_handoffStart cb
        else
            @_normalStart cb

    #----------

    _handoffStart: (cb) ->
        @_acceptHandoff (err) =>
            if err
                @log.error "_handoffStart Failed! Falling back to normal start: #{err}"
                @_normalStart cb

    #----------

    _normalStart: (cb) ->
        @log.info "Attaching listeners."
        @master.sourcein.listen()
        @handle = @server.listen @opts.port

        if @api_server
            @log.info "Starting API server on port #{@opts.api_port}"
            @api_handle = @api_server.listen @opts.api_port

        cb? null, @

    #----------

    status: (cb) ->
        status = master:null, slave:null

        aF = _.after 2, =>
            cb null, status

        # master status
        status.master = @master.status()
        aF()

        # slave status
        @slave._streamStatus (err,s) =>
            return cb err if err
            status.slave = s
            aF()

    #----------

    _sendHandoff: (rpc) ->
        @log.event "Got handoff signal from new process."

        debug "In _sendHandoff. Waiting for config."

        rpc.once "configured", (msg,handle,cb) =>
            debug "... got configured. Syncing running config."

            # send stream/source info so we make sure our configs are matched
            rpc.request "config", @master.config(), (err,streams) =>
                if err
                    @log.error "Error setting config on new process: #{err}"
                    cb "Error sending config: #{err}"
                    return false

                @log.info "New process confirmed configuration."
                debug "New process confirmed configuration."

                # basically we leave the config request open while we send streams
                cb()

                @master.sendHandoffData rpc, (err) =>
                    @log.event "Sent master data to new process."

                    _afterSockets = _.after 3, =>
                        debug "Socket transfer is done."
                        @log.info "Sockets transferred. Sending listeners."

                        # Send slave listener data
                        debug "Beginning listener transfer."
                        @slave.ejectListeners (obj,h,lcb) =>
                            debug "Sending a listener...", obj
                            @_rpc.request "stream_listener", obj, h, (err) =>
                                debug "Listener transfer error: #{err}" if err
                                lcb()
                        , (err) =>
                            @log.error "Error sending listeners during handoff: #{err}" if err

                            @log.info "Standalone handoff has sent all information. Exiting."
                            debug "Standalone handoff complete. Exiting."

                            # Exit
                            process.exit()

                    # Hand over our public listening port
                    @log.info "Hand off standalone socket."
                    rpc.request "standalone_handle", null, @handle, (err) =>
                        @log.error "Error sending standalone handle: #{err}" if err
                        debug "Standalone socket sent: #{err}"
                        @handle.unref()
                        _afterSockets()

                    # Hand over the source port
                    @log.info "Hand off source socket."
                    rpc.request "source_socket", null, @master.sourcein.server, (err) =>
                        @log.error "Error sending source socket: #{err}" if err
                        debug "Source socket sent: #{err}"
                        @master.sourcein.server.unref()
                        _afterSockets()

                    @log.info "Hand off API socket (if it exists)."
                    rpc.request "api_handle", null, @api_handle, (err) =>
                        @log.error "Error sending API socket: #{err}" if err
                        debug "API socket sent: #{err}"
                        @api_handle?.unref()
                        _afterSockets()

    #----------

    _acceptHandoff: (cb) ->
        @log.info "Initializing handoff receptor."

        debug "In _acceptHandoff"

        if !@_rpc
            cb new Error "Handoff called, but no RPC interface set up."
            return false

        # If we don't get HANDOFF_GO quickly, something is probably wrong.
        # Perhaps we've been asked to start via handoff when there's no process
        # out there to send us data.
        handoff_timer = setTimeout =>
            debug "Handoff failed to handshake. Done waiting."
            cb new Error "Handoff failed to handshake within five seconds."
        , 5000

        debug "Waiting for HANDOFF_GO"
        @_rpc.once "HANDOFF_GO", (msg,handle,ccb) =>
            clearTimeout handoff_timer

            debug "HANDOFF_GO received."

            ccb null, "GO"

            debug "Waiting for internal configuration signal."
            @master.once_configured =>
                # signal that we're ready
                debug "Telling handoff sender that we're configured."
                @_rpc.request "configured", @master.config(), (err,reply) =>
                    if err
                        @log.error "Failed to send config broadcast when starting handoff: #{err}"
                        return false

                    debug "Handoff sender ACKed config."

                    @log.info "Handoff initiator ACKed our config broadcast."

                    @master.loadHandoffData @_rpc, =>
                        @log.info "Master handoff receiver believes all stream and source data has arrived."

                    aFunc = _.after 3, =>
                        @log.info "All handles are up."
                        cb? null, @

                    @_rpc.once "source_socket", (msg,handle,cb) =>
                        @log.info "Source socket is incoming."
                        @master.sourcein.listen handle
                        debug "Now listening on source socket."
                        cb null
                        aFunc()

                    @_rpc.once "standalone_handle", (msg,handle,cb) =>
                        @log.info "Standalone socket is incoming."
                        @handle = @server.listen handle
                        debug "Now listening on standalone socket."
                        cb null
                        aFunc()

                    @_rpc.once "api_handle", (msg,handle,cb) =>
                        if handle && @api_server
                            debug "Handoff sent API socket and we have API server"
                            @log.info "API socket is incoming."
                            @api_handle = @api_server.listen handle
                            debug "Now listening on API socket."
                        else
                            @log.info "Handoff sent no API socket"
                            debug "Handoff sent no API socket."

                            if @api_server
                                debug "Handoff sent no API socket, but we have API server. Listening."
                                @api_handle = @api_server.listen @opts.api_port

                        cb null
                        aFunc()
