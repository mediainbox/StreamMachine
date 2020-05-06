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

module.exports = class SlaveMode extends require("./base_mode")

    MODE: "Slave"
    constructor: (config,cb) ->
        super(config)

        process.title = "SM:SLAVE"
        @logger.debug "Slave mode starting"

        @_handle        = null
        @_haveHandle    = false
        @_shuttingDown  = false
        @_inHandoff     = false

        @_lastAddress   = null
        @_initFull      = false

        @slave = new Slave _.extend({}, config, logger:@log), @
