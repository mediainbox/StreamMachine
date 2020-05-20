_ = require "underscore"

debug = require("debug")("sm:rewind:rewinder")

# Rewinder is the general-purpose listener stream.
# Arguments:
# * offset: Number
#   - Where to position the playHead relative to now.  Should be a positive
#     number representing the number of seconds behind live
# * pump: Boolean||Number
#   - If true, burst 30 seconds or so of data as a buffer. If offset is 0,
#     that 30 seconds will effectively put the offset at 30. If offset is
#     greater than 0, burst will go forward from that point.
#   - If a number, specifies the number of seconds of data to pump
#     immediately.
# * pumpOnly: Boolean, default false
#   - Don't hook the Rewinder up to incoming data. Pump whatever data is
#     requested and then send EOF

module.exports = class Rewinder extends require("stream").Readable
    constructor: (@rewind,@conn_id,opts={},cb) ->
        # allow up to 256k in our read buffer before pausing
        super highWaterMark:256*1024

        # keep track of the duration of the segments we have pushed
        # Note that for non-pump requests, these will be reset periodically
        # as we report listening segments
        @_sentDuration  = 0
        @_sentBytes     = 0
        @_offsetSeconds = null
        @_contentTime   = null

        @_pumpOnly = false

        @_offset = -1

        @_queue = []
        @_queuedBytes = 0

        @_reading = false
        @_bounceRead = _.debounce =>
            @read 0
        , 100

        @_segTimer = null

        @pumpSecs = if opts.pump == true then @rewind.opts.burst else opts.pump

        finalizeFunc = (args...) =>
            # Logging
            if !@_pumpOnly
                # for non-pump requests, we want to set a timer that will
                # log a segment every 30 seconds. This allows us to use the
                # same analytics pipeline as we do for HLS pumped data
                @_segTimer = setInterval =>
                    obj =
                        id:             @conn_id
                        bytes:          @_sentBytes
                        seconds:        @_sentDuration
                        contentTime:    @_contentTime

                    @emit "listen", obj
                    @rewind.recordListen obj

                    # reset our stats
                    @_sentBytes     = 0
                    @_sentDuration  = 0
                    @_contentTime   = null

                , opts.logInterval || 30*1000

            cb null, @, args...
            finalizeFunc = null
            cb = null

        oFunc = (@_offset) =>
            debug "Rewinder: creation with ", opts:opts, offset:@_offset

            # -- What are we sending? -- #

            if opts?.live_segment
                # we're sending a segment of HTTP Live Streaming data
                @_pumpOnly = true
                @rewind.hls.pumpSegment @, opts.live_segment, (err,info) =>
                    return cb err if err

                    debug "Pumping HLS segment with ", duration:info.duration, length:info.length, offsetSeconds:info.offsetSeconds

                    @_offsetSeconds = info.offsetSeconds

                    finalizeFunc info

            else if opts?.pumpOnly
                # we're just giving one pump of data, then EOF
                @_pumpOnly = true
                @rewind.pumpFrom @, @_offset, @rewind.secsToOffset(@pumpSecs), false, (err,info) =>
                    return cb err if err

                    # return pump information
                    finalizeFunc info

            else if opts?.pump
                if @_offset == 0
                    # pump some data before we start regular listening
                    debug "Rewinder: Pumping #{@rewind.opts.burst} seconds."
                    @rewind.pumpSeconds @, @pumpSecs, true

                    finalizeFunc()
                else
                    # we're offset, so we'll pump from the offset point forward instead of
                    # back from live
                    @rewind.burstFrom @, @_offset, @pumpSecs, (err,new_offset) =>
                        return cb err if err

                        @_offset = new_offset

                        finalizeFunc()

            else
                finalizeFunc()

        if opts.timestamp
            @rewind.findTimestamp opts.timestamp, (err,offset) =>
                return cb err if err
                oFunc offset

        else
            offset =
                if opts.offsetSecs
                    @rewind.checkOffsetSecs opts.offsetSecs
                else if opts.offset
                    @rewind.checkOffset opts.offset
                else
                    0

            oFunc offset

    #----------

    onFirstMeta: (cb) ->
        if @_queue.length > 0
            cb? null, @_queue[0].meta
        else
            @once "readable", =>
                cb? null, @_queue[0].meta

    #----------

    # Implement the guts of the Readable stream. For a normal stream,
    # RewindBuffer will be calling _insert at regular ticks to put content
    # into our queue, and _read takes the task of buffering and sending
    # that out to the listener.

    _read: (size) =>
        # we only want one queue read going on at a time, so go ahead and
        # abort if we're already reading
        if @_reading
            return false

        # -- push anything queued up to size -- #

        # set a read lock
        @_reading = true

        sent = 0

        # Set up pushQueue as a function so that we can call it multiple
        # times until we get to the size requested (or the end of what we
        # have ready)

        _pushQueue = =>
            # -- Handle an empty queue -- #

            # In normal operation, you can think of the queue as infinite,
            # but not speedy.  If we've sent everything we have, we'll send
            # out an empty string to signal that more will be coming.  On
            # the other hand, in pump mode we need to send a null character
            # to signal that we've reached the end and nothing more will
            # follow.

            _handleEmpty = =>
                if @_pumpOnly
                    @push null

                else
                    @push ''

                @_reading = false
                return false

            # See if the queue is empty to start with
            if @_queue.length == 0
                return _handleEmpty()

            # Grab a chunk off of the queued up buffer
            next_buf = @_queue.shift()

            # This shouldn't happen...
            if !next_buf
                @rewind.log.error "Shifted queue but got null", length:@_queue.length

            @_queuedBytes   -= next_buf.data.length
            @_sentBytes     += next_buf.data.length
            @_sentDuration  += (next_buf.duration / 1000)

            debug "Sent duration is now #{ @_sentDuration }"

            # Not all chunks will contain metadata, but go ahead and send
            # ours out if it does
            if next_buf.meta
                @emit "meta", next_buf.meta

            # Push the chunk of data onto our reader. The return from push
            # will tell us whether to keep pushing, or whether we need to
            # stop and wait for a drain event (basically wait for the
            # reader to catch up to us)

            if @push next_buf.data
                sent += next_buf.data.length

                if sent < size && @_queue.length > 0
                    _pushQueue()
                else
                    if @_queue.length == 0
                        _handleEmpty()

                    else
                        @push ''
                        @_reading = false

            else
                # give a signal that we're here for more when they're ready
                @_reading = false
                @emit "readable"

        _pushQueue()

    #----------

    _insert: (b) =>
        @_queue.push b
        @_queuedBytes += b.data.length

        # we set contentTime the first time we find it unset, which will be
        # either on our first insert or on our first insert after logging
        # has happened
        @_contentTime = b.ts if !@_contentTime

        @_bounceRead() if !@_reading

    #----------

    # Set a new offset (in seconds)
    setOffset: (offset) ->
        # -- make sure our offset is good -- #

        @_offset = @rewind.checkOffsetSecs offset

        # clear out the data we had buffered
        @_queue.slice(0)

        if @_offset == 0
            # pump some data before we start regular listening
            debug "Rewinder: Pumping #{@rewind.opts.burst} seconds."
            @rewind.pumpSeconds @, @pumpSecs
        else
            # we're offset, so we'll pump from the offset point forward instead of
            # back from live
            [@_offset,data] = @rewind.burstFrom @_offset, @pumpSecs
            @_queue.push data

        @_offset

    #----------

    # Return the current offset in chunks
    offset: ->
        @_offset

    #----------

    # Return the current offset in seconds
    offsetSecs: ->
        @rewind.offsetToSecs @_offset

    #----------

        @rewind._rremoveListener @
    disconnect: ->

        # Record either a) our full listening session (pump requests) or
        # b) the portion of the request that we haven't already recorded
        # (non-pump requests)
        obj =
            id:             @conn_id
            bytes:          @_sentBytes
            seconds:        @_sentDuration
            offsetSeconds:  @_offsetSeconds
            contentTime:    @_contentTime

        @emit "listen", obj
        @rewind.recordListen obj

        # clear our listen segment timer
        clearInterval @_segTimer if @_segTimer

        # This just takes the listener out of lmeta. This will probably go
        # away at some point or be rolled into the function above
        @rewind.disconnectListener @conn_id

        # make sure we're freed up for GC
        @removeAllListeners()


#----------
