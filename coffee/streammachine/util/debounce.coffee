now = ->
    Number(new Date())

module.exports = class Debounce
    constructor: (@wait,@cb) ->
        @last = null
        @timeout = null

        @_t = =>
            ago = now() - @last

            if ago < @wait && ago >= 0
                @timeout = setTimeout @_t, @wait - ago
            else
                @timeout = null
                @cb @last

    ping: ->
        @last = now()

        if !@timeout
            @timeout = setTimeout @_t, @wait

        true

    kill: ->
        clearTimeout @timeout if @timeout
        @cb = null
