# Runner is a process manager that allows StreamMachine instances to live
# restart, transferring state between old and new processes.

debug = require("debug")("sm:runner")

path    = require "path"
fs      = require "fs"
cp      = require "child_process"
Watch   = require "watch-for-path"

args = require("yargs")
    .usage("Usage: $0 --watch [watch file] --title [title] --config [streammachine config file]")
    .describe
        watch:      "File to watch for restarts"
        title:      "Process title suffix"
        restart:    "Trigger handoff if watched path changes"
        config:     "Config file to pass to StreamMachine"
        dir:        "Directory path for StreamMachine"
        coffee:     "Run via coffeescript"
    .default
        restart:    true
        coffee:     false
    .demand(['config'])
    .argv

class StreamMachineRunner extends require("events").EventEmitter
    constructor: (@_streamer,@_args) ->
        super()

        @process        = null
        @_terminating   = false
        @_inHandoff     = false

        @_command = "#{@_streamer} --config=#{@_args.config}"

        process.title =
            if @_args.title
                "StreamR:#{@_args.title}"
            else
                "StreamR"

        if @_args.watch
            console.error "Setting a watch on #{ @_args.watch } before starting up."

            new Watch @_args.watch, (err) =>
                throw err if err

                debug "Found #{ @_args.watch }. Starting up."

                if @_args.restart
                    # now set a normal watch on the now-existant path, so that
                    # we can restart if it changes
                    @_w = fs.watch @_args.watch, (evt,file) =>
                        debug "fs.watch fired for #{@_args.watch} (#{evt})"
                        @emit "_restart"

                    last_m = null
                    @_wi = setInterval =>
                        fs.stat @_args.watch, (err,stats) =>
                            return false if err

                            if last_m
                                if Number(stats.mtime) != last_m
                                    debug "Polling found change in #{@_args.watch}."
                                    @emit "_restart"
                                    last_m = Number(stats.mtime)

                            else
                                last_m = Number(stats.mtime)

                    , 1000

                # path now exists...
                @_startUp()

                last_restart = null
                @on "_restart", =>
                    cur_t = Number(new Date)
                    if @process? && (!last_restart || cur_t - last_restart > 1200)
                        last_restart = cur_t
                        # send a kill, then let our normal exit code handle the restart
                        debug "Triggering restart after watched file change."
                        @restart()
        else
            @_startUp()

    #----------

    _startUp: ->
        _start = =>
            @process = @_spawn(false)
            debug "Startup process PID is #{ @process.p.pid }."

        if !@process
            _start()
        else
            # we expect the process to be shut down
            try
                # signal 0 tests whether process exists
                process.kill worker.pid, 0

                # if we get here we've failed
                debug "Tried to start command while it was already running."
            catch e
                # not running... start a new one

                @process.p.removeAllListeners()
                @process.p = null

                uptime = Number(new Date) - @process.start
                debug "Command uptime was #{ Math.floor(uptime / 1000) } seconds."

                _start()

    #----------

    _spawn: (isHandoff=false) ->
        debug "Should start command: #{@_command}"

        cmd = @_command.split(" ")

        if isHandoff
            cmd.push "--handoff"

        # FIXME: Are there any opts we would want to pass?
        opts = {}

        process = p:null, start:Number(new Date), stopping:false
        process.p = cp.fork cmd[0], cmd[1..], opts

        #process.p.stderr.pipe(process.stderr)

        process.p.once "error", (err) =>
            debug "Command got error: #{err}"
            @_startUp() if !process.stopping

        process.p.once "exit", (code,signal) =>
            debug "Command exited: #{code} || #{signal}"
            @_startUp() if !process.stopping

        process

    #----------

    restart: ->
        # For restart, we need to stash our existing process and start a new
        # one with the --handoff flag. We then connect the message channels of
        # the two and let them run the handoff. When the old process exits,
        # our handoff is complete and we can install the new process as our
        # main process.

        if !@process || @process.stopping
            console.error "Restart triggered with no process running."
            return

        if @_inHandoff
            console.error "Restart triggered while in existing handoff."
            return

        @_inHandoff = true

        # grab our existing process
        old_process = @process
        @process.stopping = true

        new_process = @_spawn(true)

        handles = []

        # proxy messages between old and new
        aToB = (title,a,b) =>
            (msg,handle) =>
                debug "Message: #{title}", msg, handle?

                if handle && handle.destroyed
                    # lost handle mid-flight... send message without it
                    b.send msg
                else
                    try
                        b.send msg, handle
                        handles.push handle if handle?
                    catch e
                        if e instanceOf TypeError
                            console.error "HANDLE SEND ERROR:: #{err}"

                            # send without the handle
                            b.send msg

        oToN = aToB("Old -> New",old_process.p,new_process.p)
        nToO = aToB("New -> Old",new_process.p,old_process.p)

        old_process.p.on "message", oToN
        new_process.p.on "message", nToO

        # watch for the old instance to die
        old_process.p.once "exit", =>
            # detach our proxies
            new_process.p.removeListener "message", nToO
            debug "Handoff completed."

            for h in handles
                h.close?()

            @process = new_process
            @_inHandoff = false

        # send SIGUSR2 to start the process
        process.kill old_process.p.pid, "SIGUSR2"

    #----------

    terminate: (cb)->
        @_terminating = true

        if @process
            @process.stopping = true
            @process.p.once "exit", =>
                debug "Command is stopped."

                uptime = Number(new Date) - @process.start
                debug "Command uptime was #{ Math.floor(uptime / 1000) } seconds."

                @process = null
                cb()

            @process.p.kill()
        else
            debug "Stop called with no process running?"
            cb()

#----------

# This is to enable running in dev via coffee. Is it foolproof? Probably not.

streamer_path =
    if args.coffee
        path.resolve(args.dir||__dirname,"./coffee.js")
    else
        if args.dir
            path.resolve(args.dir,"js/streamer.js")
        else
            path.resolve(__dirname,"./streamer.js")

debug "Streamer path is #{streamer_path}"

runner = new StreamMachineRunner streamer_path, args


_handleExit = ->
    runner.terminate ->
        debug "StreamMachine Runner exiting."
        process.exit()

process.on 'SIGINT',    _handleExit
process.on 'SIGTERM',   _handleExit

process.on 'SIGHUP', ->
    debug "Restart triggered via SIGHUP."
    runner.restart()
