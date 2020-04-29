_       = require "underscore"
nconf   = require "nconf"
path    = require "path"
RPC     = require "ipc-rpc"
net     = require "net"
http     = require "http"
CP      = require "child_process"
greenlock = require "greenlock-express"

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

        @pool = new SlaveMode.WorkerPool @, @opts.cluster, @opts
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

    _openServer: (handle,cb) ->
        @_createServer (server, fallbackHttpServer) =>
            @_server = server
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

    #----------

    _createServer: (cb) ->
        if process.env.NO_GREENLOCK
            cb http.createServer()
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

    class @WorkerPool extends require("events").EventEmitter
        constructor: (@s,@size,@config) ->
            @workers    = {}
            @_shutdown  = false

            debug "Worker pool init with size of #{@size}."

            @log = @s.log.child component:"worker_pool"

            @_nextId = 1

            @_spawn()

            # poll each worker for its status every second
            @_statusPoll = setInterval =>
                for w in @workers
                    do (w) =>
                        return if !w.rpc
                        w.rpc.request "status", (err,s) =>
                            @log.error "Worker status error: #{err}" if err
                            w.status = id:id, listening:w._listening, loaded:w._loaded, streams:s, pid:w.pid, ts:Number(new Date)
            , 1000

            process.on "exit", =>
                # try one last effort to make sure workers are closed
                w.w.kill() for id,w of @workers

        #----------

        _spawn: ->
            if @count() >= @size
                debug "Pool is now at #{ @count() }. Full strength."
                @log.debug "Pool is at full strength"
                @emit "full_strength"
                return false

            id = @_nextId
            @_nextId += 1

            debug "Spawning worker #{id}."
            p = CP.fork path.resolve(__dirname,"./slave_worker.js")
            debug "Worker #{id} forked with pid of #{p.pid}"

            @log.debug "Spawning new worker.", count:@count(), target:@size

            w = new SlaveMode.Worker
                id:         id
                w:          p
                rpc:        null
                pid:        p.pid
                status:     null
                _loaded:    false
                _config:    false

            w.rpc = new RPC p, functions:

                # triggered by the worker once it has its streams configured
                # (though they may not yet have data to give out)
                worker_configured: (msg,handle,cb) =>
                    @log.debug "Worker #{w.id} is configured."
                    w._config = true
                    cb null

                #---

                # sent by the worker once its stream rewinds are loaded.
                # tells us that it's safe to trigger a new worker launch
                rewinds_loaded: (msg,handle,cb) =>
                    @log.debug "Worker #{w.id} is loaded."
                    w._loaded = true
                    @emit "worker_loaded"

                    # ACK
                    cb null

                    # now that we're done, see if any more workers need to start
                    debug "Worker #{w.id} rewind loaded. Attempting new spawn."
                    @_spawn()

                #---

                # a worker is allowed to shed listeners at any point by
                # sending them here. This could be part of a handoff (where
                # we've asked for the listeners), or part of the worker
                # crashing / shutting down
                send_listener: (msg,handle,cb) =>
                    @s._listenerFromWorker w.id, msg, handle, cb

                #---

                # triggered by the worker to request configuration
                config: (msg,handle,cb) =>
                    cb null, @config

            , (err) =>
                if err
                    @log.error "Error setting up RPC for new worker: #{err}"
                    worker.kill()
                    return false

                @log.debug "Worker #{w.id} is set up.", id:w.id, pid:w.pid
                debug "Worker #{w.id} RPC is set up."

                @workers[ w.id ] = w

            # -- Handle disconnects and exits -- #

            p.once "exit", =>
                debug "Got exit from worker process #{w.id}"
                @log.info "SlaveWorker exit: #{w.id}"
                delete @workers[ w.id ]

                w.emit "exit"
                w.destroy()

                @_spawn() if !@_shutdown

            # error seems to be thrown for issues sending IPC
            p.on "error", (err) =>
                debug "Error from worker process #{w.id}: #{err}"
                @log.error "Error from SlaveWorker process: #{err}"
                # FIXME: What else should we do?

        #----------

        count: ->
            Object.keys(@workers).length

        #----------

        loaded_count: ->
            _(@workers).select((w) -> w._loaded).length

        #----------

        once_loaded: (cb) ->
            if @loaded_count() == 0
                @once "worker_loaded", => cb null
            else
                cb null

        #----------

        shutdown: (cb) ->
            @_shutdown = true

            # send kill signals to all workers
            @log.info "Slave WorkerPool is exiting."

            if @count() == 0
                clearInterval @_statusPoll
                cb null

            af = _.after @count(), =>
                clearInterval @_statusPoll
                cb null

            for id,w of @workers
                @shutdownWorker id, (err) =>
                    af()

        #----------

        shutdownWorker: (id,cb) ->
            if !@workers[id]
                cb? "Cannot call shutdown: Worker id unknown"
                return false

            @log.info "Sending shutdown to worker #{id}"
            @workers[id].rpc.request "shutdown", {}, (err) =>
                if err
                    @log.error "Shutdown errored: #{err}"
                    return false

                cb = _.once cb

                # set a shutdown timer
                timer = setTimeout =>
                    @log.error "Failed to get worker exit before timeout. Trying kill."
                    w.w.kill()

                    timer = setTimeout =>
                        cb "Failed to shut down worker."
                    , 500

                , 1000

                # now watch for the worker's exit event
                @workers[id].once "exit", =>
                    @log.info "Shutdown succeeded for worker #{id}."
                    clearTimeout timer if timer
                    cb null

        #----------

        getWorker: (exclude_id) ->
            # we want loaded workers, excluding the passed-in id if provided
            workers = if exclude_id
                _(@workers).select (w) -> w._loaded && w.id != exclude_id
            else
                _(@workers).select (w) -> w._loaded

            if workers.length == 0
                return null
            else
                # From this pool of eligible workers, choose the one that seems
                # most appropriate to get new traffic.

                # FIXME: How about the one that has sent the least bytes?
                #return _.min workers, (w) -> w.status.bytes_sent

                return _.sample(workers)

        #----------

        status: (cb) ->
            status = {}

            af = _.after Object.keys(@workers).length, =>
                cb null, status

            for id,w of @workers
                do (id,w) =>
                    w.rpc.request "status", (err,s) =>
                        @log.error "Worker status error: #{err}" if err
                        status[ id ] = id:id, listening:w._listening, loaded:w._loaded, streams:s, pid:w.pid
                        af()

    #----------

    class @Worker extends require("events").EventEmitter
        constructor: (attributes) ->
            @[k] = v for k,v of attributes

        destroy: ->
            @removeAllListeners()
