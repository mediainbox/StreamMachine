module.exports = class Core extends require("events").EventEmitter
    constructor: ->
        super()

        # see runner for restart trigger based on SIGUSR2
        @log.debug "Attaching listener for SIGUSR2 restarts."

        if process.listeners("SIGUSR2").length > 0
            @log.info "Skipping SIGUSR2 registration for handoffs since another listener is registered."
        else
            # Support a handoff trigger via USR2
            process.on "SIGUSR2", =>
                if @_restarting
                    return false

                @_restarting = true

                # replacement process is spawned externally

                # make sure there's an external process out there...
                if !@_rpc
                  @log.error "StreamMachine process was asked for external handoff, but there is no RPC interface"
                  @_restarting = false
                  return false

                @log.info "Sending process for USR2. Starting handoff via proxy."

                @_rpc.request "HANDOFF_GO", null, null, timeout:20000, (err,reply) =>
                    if err
                        @log.error "Error handshaking handoff: #{err}"
                        @_restarting = false
                        return false

                    @log.info "Sender got handoff handshake. Starting send."
                    @_sendHandoff @_rpc

    #----------

    # Build a hash of stream information, including sources and listener counts

    streamInfo: ->
        s.info() for k,s of @streams

    #----------
