_       = require "underscore"
URL     = require "url"
winston = require "winston"
tz      = require "timezone"
nconf   = require "nconf"

debug = require("debug")("sm:analytics")

AnalyticsEsStore = require "./store/es_store"

# This module is responsible for:

# * Listen for session_start and listen interactions
# * Watch for sessions that are no longer active.  Finalize them, attaching
#   stats and duration, and throwing out sessions that did not meet minimum
#   requirements
# * Answer questions about current number of listeners at any given time

module.exports = class Analytics
    constructor: (@ctx) ->
        @logger = @ctx.logger.child(
            component: "analytics"
        )

        @config = @ctx.config.analytics
        @_timeout_sec = Number(@config.finalize_secs)

        if @ctx.providers.redis
            @redis = @ctx.providers.redis

        # track open sessions
        @sessions = {}

        @local = tz(require "timezone/zones")(nconf.get("timezone")||"UTC")


        @store = new AnalyticsEsStore(@config, @ctx)

        # -- are there any sessions that should be finalized? -- #
        # when was our last finalized session?
        #last_session = @influx.query "SELECT max(time) from sessions", (err,res) =>
        #    console.log "last session is ", err, res
        # what sessions have we seen since then?

        # -- Redis Session Sweep -- #
        if @redis
            @logger.info "Analytics setting up Redis session sweeper"

            setInterval =>
                # look for sessions that should be written (score less than now)
                @redis.client.zrangebyscore "session-timeouts", 0, Math.floor( Number(new Date) / 1000), (err,sessions) =>
                    return @logger.error "Error fetching sessions to finalize: #{err}" if err

                    _sFunc = =>
                        if s = sessions.shift()
                            @_triggerSession s
                            _sFunc()

                    _sFunc()

            , 5*1000

    #----------

    _log: (obj,cb) ->
        session_id = null

        if !obj.client?.session_id
            cb? new Error "Object does not contain a session ID"
            return false

        # write one index per day of data
        index_date = tz(obj.time,"%F")

        time = new Date( obj.time )

        # clean up IPv4 IP addresses stuck in IPv6
        if obj.client?.ip
            obj.client.ip = obj.client.ip.replace /^::ffff:/, ""

        @_indicesForTimeRange "listens", time, (err,idx) =>
            switch obj.type
                when "session_start"
                    @idx_batch.write index:idx[0], body:
                        time:       new Date(obj.time)
                        session_id: obj.client.session_id
                        stream:     obj.stream_group || obj.stream
                        client:     obj.client
                        type:       "start"

                    cb? null

                    # -- start tracking the session -- #

                when "listen"
                    # do we know of other duration for this session?
                    @_getStashedDurationFor obj.client.session_id, obj.duration, (err,dur) =>
                        @idx_batch.write index:idx[0], body:
                            session_id:         obj.client.session_id
                            time:               new Date(obj.time)
                            kbytes:             obj.kbytes
                            duration:           obj.duration
                            session_duration:   dur
                            stream:             obj.stream
                            client:             obj.client
                            offsetSeconds:      obj.offsetSeconds
                            contentTime:        obj.contentTime
                            type:               "listen"

                        cb? null

            # -- update our timer -- #

            @_updateSessionTimerFor obj.client.session_id, (err) =>

    #----------

    # Given a session id and duration, add the given duration to any
    # existing cached duration and return the accumulated number
    _getStashedDurationFor: (session,duration,cb) ->
        if @redis
            # use redis stash
            key = "duration-#{session}"
            @redis.client.incrby key, Math.round(duration), (err,res) =>
                cb err, res

            # set a TTL on our key, so that it doesn't stay indefinitely
            @redis.client.pexpire key, 5*60*1000, (err) =>
                @logger.error "Failed to set Redis TTL for #{key}: #{err}" if err

        else
            # use memory stash
            s = @_ensureMemorySession session
            s.duration += duration
            cb null, s.duration

    #----------

    _updateSessionTimerFor: (session,cb) ->
        if @_timeout_sec <= 0
            # timeouts are disabled
            return cb null

        if @redis
            # this will set the score, or update it if the session is
            # already in the set
            timeout_at = (Number(new Date) / 1000) + @_timeout_sec

            @redis.client.zadd "session-timeouts", timeout_at, session, (err) =>
                cb err

        else
            s = @_ensureMemorySession session

            clearTimeout s.timeout if s.timeout

            s.timeout = setTimeout =>
                @_triggerSession session
            , @_timeout_sec * 1000

            cb null

    #----------

    _scrubSessionFor: (session,cb) ->
        if @redis
            @redis.client.zrem "session-timeouts", session, (err) =>
                return cb err if err

                @redis.client.del "duration-#{session}", (err) =>
                    cb err

        else
           s = @_ensureMemorySession session
           clearTimeout s.timeout if s.timeout
           delete @sessions[session]

           cb null


    #----------

    _ensureMemorySession: (session) ->
        @sessions[ session ] ||=
            duration:0, last_seen_at:Number(new Date()), timeout:null

    #----------

    _triggerSession: (session) ->
        @_scrubSessionFor session, (err) =>
            return @logger.error "Error cleaning session cache: #{err}" if err

            @_finalizeSession session, (err,obj) =>
                return @logger.error "Error assembling session: #{err}" if err

                if obj
                    @_storeSession obj, (err) =>
                        @logger.error "Error writing session: #{err}" if err

    #----------

    countListeners: (cb) ->
        return @store.countListeners(cb)

    #----------

    _finalizeSession: (id,cb) ->
        @logger.debug "Finalizing session for #{ id }"

        # This is a little ugly. We need to take several steps:
        # 1) Have we ever finalized this session id?
        # 2) Look up the session_start for the session_id
        # 3) Compute the session's sent kbytes, sent duration, and elapsed duration
        # 4) Write a session object

        session = {}

        # -- Get Started -- #

        @_selectPreviousSession id, (err,ts) =>
            if err
                @logger.error err
                return cb? err

            @_selectSessionStart id, (err,start) =>
                if err
                    @logger.error err
                    return cb err

                if !start
                    @logger.debug "Attempt to finalize invalid session. No start event for #{id}."
                    return cb null, false

                @_selectListenTotals id, ts, (err,totals) =>
                    if err
                        @logger.error err
                        return cb? err

                    if !totals
                        # Session did not have any recorded listen events.  Toss it.
                        return cb null, false

                    # -- build session -- #

                    session =
                        session_id: id
                        output:     start.output
                        stream:     start.stream
                        time:       totals.last_listen
                        start_time: ts || start.time
                        client:     start.client
                        kbytes:     totals.kbytes
                        duration:   totals.duration
                        connected:  ( Number(totals.last_listen) - Number(ts||start.time) ) / 1000

                    cb null, session