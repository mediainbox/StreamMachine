_       = require "underscore"
express = require "express"
nconf   = require "nconf"
RPC     = require "ipc-rpc"
Logger  = require "../logger"
Master  = require "../master"

debug = require("debug")("sm:modes:master")

# Master Server
#
# Masters don't take client connections directly. They take incoming
# source streams and proxy them to the slaves, providing an admin
# interface and a point to consolidate logs and listener counts.

module.exports = class MasterMode extends require("./base_mode")

    MODE: "Master"

    constructor: (config, cb) ->
        super(config)

        process.title = "SM:MASTER"
        @logger.debug "master mode start"

        # create a master
        @master = new Master(@ctx)

        # Set up a server for our admin
        @server = express()
        @server.use "/s",   @master.transport.app
        @server.use "/api", @master.api.app

        if process.send?
            @_rpc = new RPC process, functions:
                OK: (msg,handle,cb) ->
                    cb null, "OK"

                master_port: (msg,handle,cb) =>
                    cb null, @handle?.address().port||"NONE"

                source_port: (msg,handle,cb) =>
                    cb null, @master.sourcein?.server.address()?.port||"NONE"

                config: (config,handle,cb) =>
                    @master.configure config, (err) =>
                        cb err, @master.config()

                #start_handoff: (msg,handle,cb) =>
                #    @_sendHandoff()
                #    cb null, "OK"

        if nconf.get("handoff")
            @_handoffStart cb
        else
            @_normalStart cb

    #----------

    _handoffStart: (cb) ->
        @_acceptHandoff (err) =>
            if err
                @logger.error "_handoffStart Failed! Falling back to normal start: #{err}"
                @_normalStart cb

    #----------

    _normalStart: (cb) ->
        # load any rewind buffers from disk
        @master.loadRewinds()

        port = @ctx.config.master.port
        @handle = @server.listen port
        @master.slaveServer.listen(@handle)
        @master.sourcein.listen()

        @logger.info "master server listening on port #{port}"

        cb? null, @

    #----------

    _sendHandoff: (rpc) ->
        @logger.info "Got handoff signal from new process."

        debug "In _sendHandoff. Waiting for config."

        rpc.once "configured", (msg,handle,cb) =>
            debug "Handoff recipient is configured. Syncing running config."

            # send stream/source info so we make sure our configs are matched
            rpc.request "config", @master.config(), (err,streams) =>
                if err
                    @logger.error "Error setting config on new process: #{err}"
                    cb "Error sending config: #{err}"
                    return false

                @logger.info "New Master confirmed configuration."
                debug "New master confirmed configuration."

                # basically we leave the config request open while we send streams
                cb()

                # Send master data (includes source port handoff)
                debug "Calling sendHandoffData"
                @master.sendHandoffData rpc, (err) =>
                    debug "Back in _sendHandoff. Sending listening sockets."

                    @logger.info "Sent master data to new process."

                    _afterSockets = _.after 2, =>
                        debug "Socket transfer is done."
                        @logger.info "Sockets transferred.  Exiting."
                        process.exit()

                    # Hand over the source port
                    @logger.info "Hand off source socket."
                    rpc.request "source_socket", null, @master.sourcein.server, (err) =>
                        @logger.error "Error sending source socket: #{err}" if err
                        _afterSockets()

                    @logger.info "Hand off master socket."
                    rpc.request "master_handle", null, @handle, (err) =>
                        @logger.error "Error sending master handle: #{err}" if err
                        _afterSockets()

    #----------

    _acceptHandoff: (cb) ->
        @logger.info "Initializing handoff receptor."

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

            # watch for streams
            debug "Waiting for internal configuration signal."
            @master.once_configured =>
                # signal that we're ready
                debug "Telling handoff sender that we're configured."
                @_rpc.request "configured", @master.config(), (err,reply) =>
                    if err
                        @logger.error "Failed to send config broadcast when starting handoff: #{err}"
                        return false

                    debug "Handoff sender ACKed config."

                    @logger.info "Handoff initiator ACKed our config broadcast."

                    @master.loadHandoffData @_rpc, =>
                        @logger.info "Handoff receiver believes all stream and source data has arrived."

                    aFunc = _.after 2, =>
                        @logger.info "Source and Master handles are up."
                        cb? null, @

                    @_rpc.once "source_socket", (msg,handle,cb) =>
                        @logger.info "Source socket is incoming."
                        @master.sourcein.listen handle
                        cb null
                        aFunc()

                    @_rpc.once "master_handle", (msg,handle,cb) =>
                        @logger.info "Master socket is incoming."
                        @handle = @server.listen handle
                        @master.slaveServer?.listen @handle
                        cb null
                        aFunc()

    #----------
