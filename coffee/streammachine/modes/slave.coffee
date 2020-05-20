_       = require "underscore"
nconf   = require "nconf"
path    = require "path"
RPC     = require "ipc-rpc"
net     = require "net"
CP      = require "child_process"

Logger  = require "../logger"
Slave   = require "../slave"

debug = require("debug")("sm:modes:slave")

#----------

module.exports = class SlaveMode extends require("./base")

    MODE: "Slave"
    constructor: (@opts,cb) ->
        @log = (new Logger @opts.log).child({mode:'slave',pid:process.pid})
        @log.debug "Slave Instance initialized"

        debug "Slave Mode init"

        process.title = "StreamM:slave"

        super

        @_handle        = null
        @_haveHandle    = false
        @_shuttingDown  = false
        @_inHandoff     = false

        @_lastAddress   = null
        @_initFull      = false


        @slave = new Slave _.extend({}, @opts, logger:@log), @
