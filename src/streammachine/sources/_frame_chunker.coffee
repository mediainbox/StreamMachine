Transform = require("stream").Transform

module.exports = class FrameChunker extends Transform

    constructor: (@duration, @initialTime = new Date()) ->
        @_chunk_queue = []
        @_queue_duration = 0
        @_remainders = 0

        @_target = @duration

        @_last_ts = null

        super objectMode: true

#----------

    resetTime: (ts) ->
        @_last_ts = null
        @_remainders = 0
        @initialTime = ts

#----------

    _transform: (obj, encoding, cb) ->
        @_chunk_queue.push obj
        @_queue_duration += obj.header.duration

        if @_queue_duration > @_target

            # reset our target for the next chunk
            @_target = @_target + (@duration - @_queue_duration)

            # what's the total data length?
            len = 0
            len += o.frame.length for o in @_chunk_queue

            # how many frames?
            frames = @_chunk_queue.length

            # make one buffer
            buf = Buffer.concat (o.frame for o in @_chunk_queue)

            duration = @_queue_duration

            # reset queue
            @_chunk_queue.length = 0
            @_queue_duration = 0

            # what's the timestamp for this chunk? If it seems reasonable
            # to attach it to the last chunk, let's do so.

            simple_dur = Math.floor(duration)
            @_remainders += duration - simple_dur

            if @_remainders > 1
                simple_rem = Math.floor(@_remainders)
                @_remainders = @_remainders - simple_rem
                simple_dur += simple_rem

            ts =
                if @_last_ts
                    new Date(Number(@_last_ts) + simple_dur)
                else
                    @initialTime

            @_last_ts = ts

            @push
                data: buf
                ts: ts
                duration: duration
                frames: frames
                streamKey: obj.header.stream_key

        cb()
