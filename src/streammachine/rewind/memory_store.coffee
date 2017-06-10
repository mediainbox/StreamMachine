bs = require 'binary-search'

debug = require("debug")("sm:rewind:memory_store")

module.exports = class MemoryStore extends require("./base_store")
    constructor: (@max_length = null) ->
        @buffer = []

    #----------

    reset: (cb) ->
        @buffer = []
        cb? null

    #----------

    length: ->
        @buffer.length

    #----------

    _findTimestampOffset: (ts) ->
        foffset = bs @buffer, {ts:ts}, (a,b) -> Number(a.ts) - Number(b.ts)

        if foffset >= 0
            # if exact, return right away
            return @buffer.length - 1 - foffset

        else if foffset == -1
            # our timestamp would be the first one in the buffer. Return
            # whatever is there, regardless of how close
            return @buffer.length - 1

        else
            foffset = Math.abs(foffset) - 1

            # Look at this index, and the buffer before it, to see which is
            # more appropriate

            a = @buffer[ foffset - 1 ]
            b = @buffer[ foffset ]

            if Number(a.ts) <= Number(ts) < Number(a.ts) + a.duration
                # it's within a
                return @buffer.length - foffset
            else
                # is it closer to the end of a, or the beginning of b?

                da = Math.abs( Number(a.ts) + a.duration - ts )
                db = Math.abs( b.ts - ts )

                if da > db
                    return @buffer.length - foffset - 1
                else
                    return @buffer.length - foffset

    #----------

    at: (offset,cb) ->
        if offset instanceof Date
            offset = @_findTimestampOffset offset

            if offset == -1
                return cb new Error "Timestamp not found in RewindBuffer"

        else
            offset = @buffer.length - 1 if offset > @buffer.length
            offset = 0 if offset < 0

        cb null, @buffer[ @buffer.length - 1 - offset ]

    #----------

    range: (offset,length,cb) ->
        if offset instanceof Date
            offset = @_findTimestampOffset offset

            if offset == -1
                return cb new Error "Timestamp not found in RewindBuffer"

        else
            offset = @buffer.length - 1 if offset > @buffer.length
            offset = 0 if offset < 0

        length = offset if length > offset

        start = @buffer.length - 1 - offset
        end = start + length

        cb null, @buffer.slice(start,end)

    #----------

    first: ->
        @buffer[0]

    last: ->
        @buffer[ @buffer.length - 1 ]

    #----------

    clone: (cb) ->
        buf_copy = @buffer.slice(0)
        cb null, buf_copy

    #----------

    insert: (chunk) ->
        fb = @buffer[ 0 ]
        lb = @buffer[ @buffer.length - 1 ]

        fb = Number(fb.ts) if fb
        lb = Number(lb.ts) if lb
        cts = Number(chunk.ts)

        # If there is no last chunk (= no chunks) or current chunk's timestamp
        # is greather than the last one's, insert it at the end
        if !lb || cts > lb
            # append
            @buffer.push chunk
            @emit "push", chunk

        # If the current chunk's timestamp is lower than the first one's, i
        # insert it at the beginning of the array
        else if cts < fb
            # prepend
            @buffer.unshift chunk
            @emit "unshift", chunk

        # If the current chunk's timestamp matches the last chunk's,
        # it's probable that insert() was called again using the same chunk
        # Often related to dangling event handlers that were not properly removed
        else if cts == fb
            debug "Chunk timestamp already found in the buffer! [cts: #{cts}, fb: #{fb}, lb: #{lb}]"

        else
            # need to insert in the middle.
            debug "Push in the middle not implemented! [cts: #{cts}, fb: #{fb}, lb: #{lb}]"

        @_truncate()

        true

    #----------

    _truncate: ->
        # -- should we remove? -- #

        while @max_length && @buffer.length > @max_length
            b = @buffer.shift()
            @emit "shift", b

    #----------

    info: ->

    #----------
