_       = require "underscore"
nconf   = require "nconf"
path    = require "path"
RPC     = require "ipc-rpc"

Slave   = require "../slave"

#----------

module.exports = class SlaveMode extends require("./base_mode")

    MODE: "Slave"
    constructor: (config,cb) ->
        super(config)

        process.title = "SM:SLAVE"
        @logger.debug "slave mode start"

        @_handle        = null
        @_haveHandle    = false
        @_shuttingDown  = false
        @_inHandoff     = false

        @_lastAddress   = null
        @_initFull      = false

        @slave = new Slave(@ctx)
