
module.exports = class BaseStore extends require("events").EventEmitter
    constructor: ->

    setMax: (l) ->
        @max_length = l
        @_truncate()

    length: ->

    at: (i) ->

    insert: (chunk) ->

    info: ->
