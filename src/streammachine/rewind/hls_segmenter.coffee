_           = require "underscore"
tz          = require 'timezone'
Debounce    = require "../util/debounce"

# -- HTTP Live Streaming Segmenter -- #

# each segment would include:
# id:       timestamp
# duration: cumulative timestamp
# buffers:  array of buffer refs
# header:   computed ID3 header

MAX_PTS = Math.pow(2,33) - 1

module.exports = class HLSSegmenter extends require("events").EventEmitter
    constructor: (@rewind,@segment_length,@log) ->
        super()

        @segments = []
        @_rewindLoading = false

        # Injector creates segment objects out of audio chunks. It doesn't
        # do segment IDs, ordering or discontinuities
        @injector = new HLSSegmenter.Injector @segment_length * 1000, @log


        # Finalizer takes the half-baked segments, gives them IDs and puts them
        # in the correct order. We defer loading the finalizer object until
        # either a) data starts coming into the injector or b) we get a map
        # loaded

        @_snapDebounce = new Debounce 1000, =>
            @finalizer.snapshot (err,snap) =>
                @emit "snapshot", segment_duration:@segment_length,segments:snap

        @finalizer = null

        @_createFinalizer = _.once (map) =>
            @finalizer = new HLSSegmenter.Finalizer @log, @segment_length * 1000, map
            @injector.pipe(@finalizer)
            @segments = @finalizer.segments

            @finalizer.on "add", => @_snapDebounce.ping()
            @finalizer.on "remove", =>
                @_snapDebounce.ping()
                @group?.hlsUpdateMinSegment Number(@segments[0].ts) if !@_rewindLoading && @segments[0]

            @emit "_finalizer"

        @injector.once "readable", =>
            # we'll give one more second for a map to come in. Data will just
            # queue up in the injector
            setTimeout =>
                @_createFinalizer()
            , 1000

        # The RewindBuffer can get data simultaneously inserted from two
        # directions.  New live data will be emitted as an rpush and will
        # go forward in timestamp.  Loading buffer data will be emitted
        # as an runshift and will go backward in time. We need to listen
        # and construct segments for each.

        @rewind.on "rpush",     (c) => @injector.write c
        @rewind.on "runshift",  (c) => @injector.write c

        @rewind.on "rshift", (chunk) =>
            # Data is being removed from the rewind buffer.  we should
            # clean up our segments as needed

            @finalizer?.expire chunk.ts, (err,seg_id) =>
                if err
                    @log.error "Error expiring audio chunk: #{err}"
                    return false

        # This event is triggered when RewindBuffer gets a call to loadBuffer.
        # We use it to make sure we don't emit an UpdateMinSegment call while
        # we're still loading backwards
        @rewind.once "rewind_loading", =>
            @_rewindLoading = true

        # This event is triggered when RewindBuffer's loadBuffer is completed.
        # Once we're done processing the data it received, we should update our
        # group with our first segment ID.
        @rewind.once "rewind_loaded", =>
            # ask the injector to push any initial segment that it is holding
            @injector._flush =>
                @log.debug "HLS Injector flushed"

                @once "snapshot", =>
                    @log.debug "HLS rewind loaded and settled. Length: #{@segments.length}"
                    @_rewindLoading = false

                    if @segments[0]
                        @group?.hlsUpdateMinSegment Number(@segments[0].ts)

        @_gSyncFunc = (ts) =>
            @finalizer?.setMinTS ts, (err,seg_id) =>
                @log.silly "Synced min segment TS to #{ts}. Got #{seg_id}."

    #----------

    syncToGroup: (g=null) ->
        if @group
            @group.removeListener "hls_update_min_segment", @_gSyncFunc
            @group = null

        if g
            @group = g
            @group.addListener "hls_update_min_segment", @_gSyncFunc

        true

    #----------

    _dumpMap: (cb) ->
        # dump our sequence information and a segment map from the finalizer
        if @finalizer
            @finalizer.dumpMap cb
        else
            cb null, null

    _loadMap: (map) ->
        @_createFinalizer map

    #----------

    status: ->
        status =
            hls_segments:       @segments.length
            hls_first_seg_id:   @segments[0]?.id
            hls_first_seg_ts:   @segments[0]?.ts
            hls_last_seg_id:    @segments[ @segments.length - 1 ]?.id
            hls_last_seg_ts:    @segments[ @segments.length - 1 ]?.ts

    #----------

    snapshot: (cb) ->
        if @finalizer
            @finalizer.snapshot (err,segments) =>
                cb null,
                    segments:           segments
                    segment_duration:   @segment_length
        else
            cb null, null

    #----------

    pumpSegment: (id,cb) ->
        if seg = @segment_idx[ id ]
            cb null, seg
        else
            cb new Error "HTTP Live Streaming segment not found."

    #----------

    class @Injector extends require("stream").Transform
        constructor: (@segment_length,@log) ->
            super objectMode:true

            @first_seg  = null
            @last_seg   = null

        #----------

        _transform: (chunk,encoding,cb) ->
            if @last_seg && ( @last_seg.ts <= chunk.ts < @last_seg.end_ts )
                # in our chunk going forward
                @last_seg.buffers.push chunk
                return cb()

            else if @first_seg && ( @first_seg.ts <= chunk.ts < @first_seg.end_ts )
                # in our chunk going backward
                @first_seg.buffers.unshift chunk
                return cb()

            else if !@last_seg || (chunk.ts >= @last_seg.end_ts)
                # create a new segment for it
                seg = @_createSegment chunk.ts

                return cb() if !seg

                seg.buffers.push chunk

                if !@first_seg
                    @first_seg = @last_seg
                else
                    # send our previous segment off to be finalized
                    if @last_seg
                        @emit "push", @last_seg
                        @push @last_seg

                # stash our new last segment
                @last_seg = seg

                return cb()

            else if !@first_seg || (chunk.ts < @first_seg.ts)
                # create a new segment for it
                seg = @_createSegment chunk.ts

                return cb() if !seg

                seg.buffers.push chunk

                # send our previous first segment off to be finalized
                if @first_seg
                    @emit "push", @first_seg
                    @push @first_seg

                # stash our new first segment
                @first_seg = seg

                return cb()

            else
                @log.error "Not sure where to place segment!!! ", chunk_ts: chunk.ts
                cb()

        #----------

        _flush: (cb) ->
            # if either our first or last segments are "complete", go ahead and
            # emit them

            for seg in [@first_seg,@last_seg]
                if seg
                    duration = 0
                    duration += b.duration for b in seg.buffers
                    @log.debug "HLS Injector flush checking segment: #{seg.ts}, #{duration}"

                    if duration >= @segment_length
                        @emit "push", seg
                        @push seg

            cb()

        #----------

        _createSegment: (ts) ->
            # There are two scenarios when we're creating a segment:
            # 1) We have a segment map in memory, and we will return IDs from that
            #    map for segments that already have them assigned. This is the case
            #    if we're loading data back into memory.
            # 2) We're creating new segments, and should be incrementing the
            #    @_segmentSeq as we go.

            seg_start = Math.floor( Number(ts) / @segment_length ) * @segment_length

            # id will be filled in when we go to finalize
            id:         null
            ts:         new Date( seg_start )
            end_ts:     new Date( seg_start + @segment_length)
            buffers:    []

    #----------

    class @Finalizer extends require("stream").Writable
        constructor: (@log,@segmentLen,seg_data=null) ->
            super objectMode:true

            @segments       = []
            @segment_idx    = {}

            @segmentSeq         = seg_data?.segmentSeq || 0
            @discontinuitySeq   = seg_data?.discontinuitySeq || 0
            @firstSegment       = if seg_data?.nextSegment then Number(seg_data?.nextSegment) else null
            @segment_map        = seg_data?.segmentMap || {}

            @segmentPTS         = seg_data?.segmentPTS || (@segmentSeq * (@segmentLen*90))

            # this starts out the same and diverges backward
            @discontinuitySeqR  = @discontinuitySeq

            @_min_ts        = null


        #----------

        expire: (ts,cb) ->
            # expire any segments whose start ts values are at or below this given ts
            loop
                if (f_s = @segments[0])? && Number(f_s.ts) <= Number(ts)
                    @segments.shift()
                    delete @segment_idx[ f_s.id ]
                    @emit "remove", f_s
                else
                    break

            cb null, @segments[0]?.id

        #----------

        setMinTS: (ts,cb) ->
            ts = Number(ts) if ts instanceof Date

            @_min_ts = ts

            # Don't expire a segment with this min TS. Send expire a number one lower.
            @expire ts - 1, cb

        #----------

        dumpMap: (cb) ->
            seg_map = {}
            for seg in @segments
                if !seg.discontinuity?
                    seg_map[ Number( seg.ts ) ] = seg.id

            map =
                segmentMap:         seg_map
                segmentSeq:         @segmentSeq
                segmentLen:         @segmentLen
                segmentPTS:         @segmentPTS
                discontinuitySeq:   @discontinuitySeq
                nextSegment:        @segments[ @segments.length - 1 ]?.end_ts

            cb null, map

        #----------

        snapshot: (cb) ->
            snapshot = @segments.slice(0)
            cb null, snapshot

        #----------

        _write: (segment,encoding,cb) ->
            # stash our last segment for convenience
            last_seg = if @segments.length > 0 then @segments[ @segments.length - 1 ] else null

            # -- Compute Segment ID -- #

            seg_id  = null
            seg_pts = null
            if @segment_map[ Number(segment.ts) ]?
                seg_id = @segment_map[ Number(segment.ts) ]
                @log.silly "Pulling segment ID from loaded segment map", id:seg_id, ts:segment.ts

                # don't create a segment we've been told not to have
                if @_min_ts && segment.end_ts < @_min_ts
                    @log.debug "Discarding segment below our minimum TS.", segment_id:seg_id, min_ts:@_min_ts
                    cb()
                    return false

            else
                # with incrementing segment numbers, we can only create the segment
                # if our timestamp is after any existing segments. We shouldn't get
                # here if it isn't, but if we were to, we would have to throw it out
                if (!last_seg && (!@firstSegment || Number(segment.ts) > @firstSegment)) || (last_seg && Number(segment.ts) > Number(last_seg.ts))
                    seg_id = @segmentSeq
                    @segmentSeq += 1
                else
                    @log.debug "Discarding segment without ID from front of buffer.", segment_ts:segment.ts
                    cb()
                    return false

            segment.id      = seg_id

            # -- Compute Actual Start, End and Duration -- #

            sorted_buffers  = _(segment.buffers).sortBy("ts")
            last_buf        = sorted_buffers[ sorted_buffers.length - 1 ]

            segment.ts_actual       = sorted_buffers[0].ts
            segment.end_ts_actual   = new Date( Number(last_buf.ts) + last_buf.duration )

            duration        = 0
            data_length     = 0

            for b in sorted_buffers
                duration    += b.duration
                data_length += b.data.length

            segment.data_length = data_length
            segment.duration    = duration


            # we don't need the actual data any more. The HLSIndex will look the
            # data up in the RewindBuffer based on the timestamps
            delete segment.buffers

            # FIXME: This logic for this should be based on the target segment duration
            segment.ts      = segment.ts_actual     if Math.abs( segment.ts - segment.ts_actual ) > 3000
            segment.end_ts  = segment.ts_end_actual if Math.abs( segment.end_ts - segment.ts_end_actual ) > 3000

            # -- Look for Gaps -- #

            # our segment's .ts should align exactly on the .end_ts of the
            # adjacent segment (or vice-versa, if we're loading backward). If it
            # doesn't, we have a discontinuity, and we need to increment our
            # segment's discontinuity sequence

            if !last_seg || Number(segment.ts) > last_seg.ts
                # we're comparing our .ts to last_seg's .end_ts

                segment.discontinuitySeq =
                    if !last_seg || segment.ts - last_seg.end_ts == 0
                        @discontinuitySeq
                    else
                        @discontinuitySeq += 1

                # for forward-facing segments, PTS is fetched from the finalizer, and then
                # updated with our duration
                segment.pts = @segmentPTS

                @segmentPTS = Math.round(@segmentPTS + (segment.duration * 90))

                # if new PTS is above 33-bit max, roll over
                if @segmentPTS > MAX_PTS
                    @segmentPTS = @segmentPTS - MAX_PTS

                @segments.push segment

            else if Number(segment.ts) < @segments[0].ts
                # we're comparing our .end_ts to first segment's .ts

                segment.discontinuitySeq =
                    if segment.end_ts - @segments[0].ts == 0
                        @discontinuitySeqR
                    else
                        @discontinuitySeqR -= 1

                # segmentPTS will be the PTS of the following segment, minus our duration
                segment.pts = Math.round(
                    if @segments[0].pts > (segment.duration * 90)
                        @segments[0].pts - (segment.duration * 90)
                    else
                        MAX_PTS - (segment.duration * 90) + @segments[0].pts
                )

                @segments.unshift segment

            # add the segment to our index lookup
            @segment_idx[ segment.id ] = segment

            @emit "add", segment

            cb()
