nconf   = require "nconf"
_       = require "underscore"
{ createLogger } = require "../logger"

module.exports = class BaseMode extends require("events").EventEmitter
    constructor: (@config) ->
        super()

        @ctx = {
            config: @config
            logger: createLogger(@config)
            providers: {}
        }

        @logger = @ctx.logger.child({
            component: 'sm:' + @config.mode
        })
        @log = @logger # compatibility


        # see runner for restart trigger based on SIGUSR2
        @logger.debug "Attaching listener for SIGUSR2 restarts."

        if process.listeners("SIGUSR2").length > 0
            @logger.info "Skipping SIGUSR2 registration for handoffs since another listener is registered."
        else
            # Support a handoff trigger via USR2
            process.on "SIGUSR2", =>
                if @_restarting
                    return false

                @_restarting = true

                # replacement process is spawned externally

                # make sure there's an external process out there...
                if !@_rpc
                  @logger.error "StreamMachine process was asked for external handoff, but there is no RPC interface"
                  @_restarting = false
                  return false

                @logger.info "Sending process for USR2. Starting handoff via proxy."

                @_rpc.request "HANDOFF_GO", null, null, timeout:20000, (err,reply) =>
                    if err
                        @logger.error "Error handshaking handoff: #{err}"
                        @_restarting = false
                        return false

                    @logger.info "Sender got handoff handshake. Starting send."
                    @_sendHandoff @_rpc

    #----------

    # Build a hash of stream information, including sources and listener counts

    streamInfo: ->
        s.info() for k,s of @streams

    #----------
