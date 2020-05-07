# broadcasts data from a stream to all the slaves

module.exports = class StreamDataBroadcaster extends require("events").EventEmitter
    constructor: (opts) ->
        super()

        @key = opts.key
        @stream = opts.stream
        @master = opts.master

        @dataFunc = (chunk) =>
            @master.slaveServer.broadcastAudio @key, chunk

        @stream.on "data", @dataFunc

    destroy: ->
        @stream.removeListener "data", @dataFunc
        @stream = null
        @emit "destroy"

        @removeAllListeners()
