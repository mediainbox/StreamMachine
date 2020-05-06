module.exports = class RPCProxy extends require("events").EventEmitter
    constructor: (@a,@b) ->
        super()
        @messages = []

        @_aFunc = (msg,handle) =>
            @messages.push { sender:"a", msg:msg, handle:handle? }
            #console.log "a->b: #{msg.key}\t#{handle?}"
            @b.send msg, handle
            @emit "error", msg if msg.err

        @_bFunc = (msg,handle) =>
            @messages.push { sender:"b", msg:msg, handle:handle? }
            #console.log "b->a: #{msg.id || msg.reply_id}\t#{msg.key}\t#{handle?}"
            @a.send msg, handle
            @emit "error", msg if msg.err

        @a.on "message", @_aFunc
        @b.on "message", @_bFunc

    disconnect: ->
        @a.removeListener "message", @_aFunc
        @b.removeListener "message", @_bFunc
