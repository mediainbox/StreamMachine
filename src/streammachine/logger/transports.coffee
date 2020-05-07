fs          = require "fs"
path        = require "path"
Transport   = require('winston-transport')
debug = require("debug")
_ = require "lodash"

class DebugTransport extends Transport
    name: "debug"

    constructor: (opts) ->
        super opts
        @defaultFn = require("debug")("sm:log")
        @debugFnMap = {}

    getDebugFn: (info) ->
        { workerId, component } = info

        if (!component)
            return @defaultFn

        debugLabel = 'sm:' + component + (if workerId then "(w#{workerId})" else '')
        fn = @debugFnMap[debugLabel]

        if (!fn)
            fn = debug(debugLabel)
            @debugFnMap[debugLabel] = fn

        return fn

    log: (info, callback) ->
        { level, message, component, workerId, meta... } = info
        fn = @getDebugFn(info)

        metaToLog = _.pickBy(meta,(value, key) -> return typeof key != 'symbol')

        fn("[#{level}] #{message}", metaToLog)
        callback null, true


module.exports =
    DebugTransport: DebugTransport
