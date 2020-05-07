_ = require "underscore"

# Monitoring component
# - checks if a stream has no active sources
# - checks if a slave is responsive/unresponsive
# - checks if a slave buffer is out of sync with masters'

module.exports = class Monitoring extends require("events").EventEmitter
    constructor: (@ctx) ->
        super()

        @master = @ctx.master
        @logger = @ctx.logger.child({
            component: "monitoring"
        })

        # -- check monitored source mounts for sources -- #

        @_streamInt = setInterval =>
            for k,sm of @master.source_mounts
                @master.alerts.update "sourceless", sm.key, !sm.source? if sm.config.monitored
        , 5*1000

        # -- Monitor Slave Status -- #

        @_pollForSlaveSync() if @master.slaves

    #----------

    shutdown: ->
        clearInterval @_streamInt if @_streamInt
        clearInterval @_slaveInt if @_slaveInt
        @master.slaves?.removeListener "disconnect", @_dFunc

    #----------

    _pollForSlaveSync: ->
        # -- Monitor Slave IO for disconnects -- #

        @_dFunc = (slave_id) =>
            # set this in a timeout just in case we're mid-status at the time
            setTimeout =>
                # mark any alerts as cleared
                for k in ["slave_unsynced","slave_unresponsive"]
                    @master.alerts.update k, slave_id, false
            , 3000

        @master.slaves.on "disconnect", @_dFunc

        # -- poll for sync -- #

        @_slaveInt = setInterval =>
            # -- what is master's status? -- #

            mstatus = @master._rewindStatus()

            # -- Get slave status -- #

            @master.slaves.pollForSync (err,statuses) =>

                for stat in statuses
                    # -- update slave responsiveness -- #

                    if stat.UNRESPONSIVE
                        @master.alerts.update "slave_unresponsive", stat.id, true
                        break

                    @master.alerts.update "slave_unresponsive", stat.id, false

                    # -- are the rewind buffers synced to master? -- #

                    # For this we need to run through each stream, and then
                    # through each value inside to see if it is within an
                    # acceptable range

                    unsynced = false

                    for key,mobj of mstatus
                        if sobj = stat.status[key]
                            for ts in ["first_buffer_ts","last_buffer_ts"]
                                sts = Number(new Date(sobj[ts]))
                                mts = Number(mobj[ts])

                                if ( _.isNaN(sts) && _.isNaN(mts) ) || (mts - 10*1000) < sts < (mts + 10*1000)
                                    # ok
                                else
                                    @logger.info "Slave #{stat.id} sync unhealthy on #{key}:#{ts}", sts, mts
                                    unsynced = true

                        else
                            unsynced = true

                    @master.alerts.update "slave_unsynced", stat.id, unsynced
        , 10*1000
