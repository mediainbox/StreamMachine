_       = require "underscore"
nconf   = require "nconf"
path    = require "path"
RPC     = require "ipc-rpc"
http     = require "http"
greenlock = require "greenlock-express"
Core = require('./base')
Logger  = require "../logger"
Slave   = require "../slave"
WorkerPool   = require "./worker_pool"

debug = require("debug")("sm:modes:slave")

#----------


module.exports = class SlaveMode extends Core

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

        # -- Set up Internal RPC -- #

        if process.send?
            debug "Setting up RPC"
            @_rpc = new RPC process, timeout:5000, functions:
                OK: (msg,handle,cb) ->
                    cb null, "OK"

                slave_port: (msg,handle,cb) =>
                    cb null, @slavePort()

                #---

                workers: (msg,handle,cb) =>

                #---

                stream_listener: (msg,handle,cb) =>
                    @_landListener null, msg, handle, cb

                #---

                ready: (msg,handle,cb) =>
                    # We're "ready" once we have one loaded worker
                    @pool.once_loaded cb

                #---

                status: (msg,handle,cb) =>
                    @status cb

        # -- Set up Clustered Worker Pool -- #

        @pool = new WorkerPool @, @opts.cluster, @opts
        @pool.on "full_strength", => @emit "full_strength"

        process.on "SIGTERM", =>
            @pool.shutdown (err) =>
                @log.info "Pool destroyed."
                process.exit()

        # -- set up server -- #

        # We handle incoming connections here in the slave process, and then
        # distribute them to our ready workers.

        # If we're doing a handoff, we wait to receive a server handle from
        # the sending process. If not, we should go ahead and start a server
        # ourself.

        if nconf.get("handoff")
            @_acceptHandoff cb
        else
            # we'll listen via our configured port
            @_openServer null, cb

    #----------

    slavePort: ->
        @_server?.address().port

    #----------

    _openServer: (handle, cb) ->
        requestListener = (req, res) =>
            res.send('Ok')
        @_createServers requestListener, cb

        ###
        @_createServers (mainServer, altServer) =>
            @_server = mainServer
            @_server.listen handle || @opts.port, (err) =>
                if err
                    @log.error "Failed to start slave server: #{err}"
                    throw err

                @_server.on "connection", (conn) =>
                    conn.pause()
                    @_distributeConnection conn

                @log.info "Slave server is up and listening."

                cb? null, @

                if (fallbackHttpServer)
                    fallbackHttpServer.on "connection", (conn) =>
                        conn.pause()
                        @_distributeConnection conn

                    @log.info "Slave fallback http server is up and listening."
        ###

    #----------

    _createServers: (requestListener, cb) ->
        if process.env.NO_GREENLOCK
            server = http.createServer(requestListener)
            server.listen @opts.port, (err) =>
                cb null
        else
            packageRoot = path.resolve(__dirname, '../../../..')
            greenlock.init({
                packageRoot
                configDir: "./greenlock.d"
                cluster: false
                maintainerEmail: "contact@mediainbox.io"
            })
                .ready((servers) =>
                    plainServer = servers.httpServer((req, res, next) =>
                        console.log('Fallback http handling connection')
                        next()
                    )
                    secureServer = servers.httpsServer()
                    plainServer.listen(80, () =>
                        cb secureServer, plainServer
                    )
                )

    #----------

    _distributeConnection: (conn) ->
        w = @pool.getWorker()

        if !w
            @log.debug "Listener arrived before any ready workers. Waiting."
            @pool.once "worker_loaded", =>
                @log.debug "Distributing listener now that worker is ready."
                @_distributeConnection conn

            return

        @log.silly "Distributing listener to worker #{w.id} (#{w.pid})"
        w.rpc.request "connection", null, conn, (err) =>
            if err
                @log.error "Failed to land incoming connection: #{err}"
                conn.destroy()

    #----------

    shutdownWorker: (id,cb) ->
        @pool.shutdownWorker id, cb

    #----------

    status: (cb) ->
        # send back a status for each of our workers
        @pool.status cb

    #----------

    _listenerFromWorker: (id,msg,handle,cb) ->
        @log.debug "Landing listener from worker.", inHandoff:@_inHandoff
        if @_inHandoff
            # we're in a handoff. ship the listener out there
            @_inHandoff.request "stream_listener", msg, handle, (err) =>
                cb err
        else
            # we can hand the listener to any slave except the one
            # it came from
            @_landListener id, msg, handle, cb

    #----------

    # Distribute a listener to one of our ready slave workers. This could be
    # an external request via handoff, or it could be an internal request from
    # a worker instance that is shutting down.

    _landListener: (sender,obj,handle,cb) ->
        w = @pool.getWorker sender

        if w
            @log.debug "Asking to land listener on worker #{w.id}"
            w.rpc.request "land_listener", obj, handle, (err) =>
                cb err
        else
            @log.debug "No worker ready to land listener!"
            cb "No workers ready to receive listeners."

    #----------

    _sendHandoff: (rpc) ->
        @log.info "Starting slave handoff."

        # don't try to spawn new workers
        @_shuttingDown  = true
        @_inHandoff     = rpc

        # Coordinate handing off our server handle

        rpc.request "server_socket", {}, @_server?._handle, (err) =>
            if err
                @log.error "Error sending socket across handoff: #{err}"
                # FIXME: Proceed? Cancel?

            @log.info "Server socket transferred. Sending listener connections."

            # Ask the pool to shut down its workers.
            @pool.shutdown (err) =>
                @log.event "Sent slave data to new process. Exiting."

                # Exit
                process.exit()

    #----------

    _acceptHandoff: (cb) ->
        @log.info "Initializing handoff receptor."

        if !@_rpc
            @log.error "Handoff called, but no RPC interface set up. Aborting."
            return false

        @_rpc.once "HANDOFF_GO", (msg,handle,hgcb) =>
            @_rpc.once "server_socket", (msg,handle,sscb) =>
                @log.info "Incoming server handle."
                @_openServer handle, (err) =>
                    if err
                        # FIXME: How should we recover from this?
                        @log.error "Failed to start server using transferred handle."
                        return false

                    @log.info "Server started with handle received during handoff."

                _go = =>
                    # let our sender know we're ready... we're already listening for
                    # the stream_listener requests on our rpc, so our job in here is
                    # done. The rest is on the sender.
                    sscb null
                    cb? null

                # wait until we're at full strength to start transferring listeners
                if @_initFull
                    _go()
                else
                    @once "full_strength", => _go()


            hgcb null, "GO"

        if !process.send?
            @log.error "Handoff called, but process has no send function. Aborting."
            return false

        process.send "HANDOFF_GO"

    #----------

