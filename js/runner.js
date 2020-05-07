// Runner is a process manager that allows StreamMachine instances to live
// restart, transferring state between old and new processes.
var StreamMachineRunner, Watch, _handleExit, args, cp, debug, fs, path, runner, streamer_path;

debug = require("debug")("sm:runner");

path = require("path");

fs = require("fs");

cp = require("child_process");

Watch = require("watch-for-path");

args = require("yargs").usage("Usage: $0 --watch [watch file] --title [title] --config [streammachine config file]").describe({
  watch: "File to watch for restarts",
  title: "Process title suffix",
  restart: "Trigger handoff if watched path changes",
  config: "Config file to pass to StreamMachine",
  dir: "Directory path for StreamMachine",
  coffee: "Run via coffeescript"
}).default({
  restart: true,
  coffee: false
}).demand(['config']).argv;

StreamMachineRunner = class StreamMachineRunner extends require("events").EventEmitter {
  constructor(_streamer, _args) {
    super();
    this._streamer = _streamer;
    this._args = _args;
    this.process = null;
    this._terminating = false;
    this._inHandoff = false;
    this._command = `${this._streamer} --config=${this._args.config}`;
    process.title = this._args.title ? `StreamR:${this._args.title}` : "StreamR";
    if (this._args.watch) {
      console.error(`Setting a watch on ${this._args.watch} before starting up.`);
      new Watch(this._args.watch, (err) => {
        var last_m, last_restart;
        if (err) {
          throw err;
        }
        debug(`Found ${this._args.watch}. Starting up.`);
        if (this._args.restart) {
          // now set a normal watch on the now-existant path, so that
          // we can restart if it changes
          this._w = fs.watch(this._args.watch, (evt, file) => {
            debug(`fs.watch fired for ${this._args.watch} (${evt})`);
            return this.emit("_restart");
          });
          last_m = null;
          this._wi = setInterval(() => {
            return fs.stat(this._args.watch, (err, stats) => {
              if (err) {
                return false;
              }
              if (last_m) {
                if (Number(stats.mtime) !== last_m) {
                  debug(`Polling found change in ${this._args.watch}.`);
                  this.emit("_restart");
                  return last_m = Number(stats.mtime);
                }
              } else {
                return last_m = Number(stats.mtime);
              }
            });
          }, 1000);
        }
        // path now exists...
        this._startUp();
        last_restart = null;
        return this.on("_restart", () => {
          var cur_t;
          cur_t = Number(new Date());
          if ((this.process != null) && (!last_restart || cur_t - last_restart > 1200)) {
            last_restart = cur_t;
            // send a kill, then let our normal exit code handle the restart
            debug("Triggering restart after watched file change.");
            return this.restart();
          }
        });
      });
    } else {
      this._startUp();
    }
  }

  //----------
  _startUp() {
    var _start, e, uptime;
    _start = () => {
      this.process = this._spawn(false);
      return debug(`Startup process PID is ${this.process.p.pid}.`);
    };
    if (!this.process) {
      return _start();
    } else {
      try {
        // signal 0 tests whether process exists
        // we expect the process to be shut down
        process.kill(worker.pid, 0);
        // if we get here we've failed
        return debug("Tried to start command while it was already running.");
      } catch (error) {
        e = error;
        // not running... start a new one
        this.process.p.removeAllListeners();
        this.process.p = null;
        uptime = Number(new Date()) - this.process.start;
        debug(`Command uptime was ${Math.floor(uptime / 1000)} seconds.`);
        return _start();
      }
    }
  }

  //----------
  _spawn(isHandoff = false) {
    var cmd, opts, process;
    debug(`Should start command: ${this._command}`);
    cmd = this._command.split(" ");
    if (isHandoff) {
      cmd.push("--handoff");
    }
    // FIXME: Are there any opts we would want to pass?
    opts = {};
    process = {
      p: null,
      start: Number(new Date()),
      stopping: false
    };
    process.p = cp.fork(cmd[0], cmd.slice(1), opts);
    //process.p.stderr.pipe(process.stderr)
    process.p.once("error", (err) => {
      debug(`Command got error: ${err}`);
      if (!process.stopping) {
        return this._startUp();
      }
    });
    process.p.once("exit", (code, signal) => {
      debug(`Command exited: ${code} || ${signal}`);
      if (!process.stopping) {
        return this._startUp();
      }
    });
    return process;
  }

  //----------
  restart() {
    var aToB, handles, nToO, new_process, oToN, old_process;
    if (!this.process || this.process.stopping) {
      console.error("Restart triggered with no process running.");
      return;
    }
    if (this._inHandoff) {
      console.error("Restart triggered while in existing handoff.");
      return;
    }
    this._inHandoff = true;
    // grab our existing process
    old_process = this.process;
    this.process.stopping = true;
    new_process = this._spawn(true);
    handles = [];
    // proxy messages between old and new
    aToB = (title, a, b) => {
      return (msg, handle) => {
        var e;
        debug(`Message: ${title}`, msg, handle != null);
        if (handle && handle.destroyed) {
          // lost handle mid-flight... send message without it
          return b.send(msg);
        } else {
          try {
            b.send(msg, handle);
            if (handle != null) {
              return handles.push(handle);
            }
          } catch (error) {
            e = error;
            if (e(instanceOf(TypeError))) {
              console.error(`HANDLE SEND ERROR:: ${err}`);
              // send without the handle
              return b.send(msg);
            }
          }
        }
      };
    };
    oToN = aToB("Old -> New", old_process.p, new_process.p);
    nToO = aToB("New -> Old", new_process.p, old_process.p);
    old_process.p.on("message", oToN);
    new_process.p.on("message", nToO);
    // watch for the old instance to die
    old_process.p.once("exit", () => {
      var h, i, len;
      // detach our proxies
      new_process.p.removeListener("message", nToO);
      debug("Handoff completed.");
      for (i = 0, len = handles.length; i < len; i++) {
        h = handles[i];
        if (typeof h.close === "function") {
          h.close();
        }
      }
      this.process = new_process;
      return this._inHandoff = false;
    });
    // send SIGUSR2 to start the process
    return process.kill(old_process.p.pid, "SIGUSR2");
  }

  //----------
  terminate(cb) {
    this._terminating = true;
    if (this.process) {
      this.process.stopping = true;
      this.process.p.once("exit", () => {
        var uptime;
        debug("Command is stopped.");
        uptime = Number(new Date()) - this.process.start;
        debug(`Command uptime was ${Math.floor(uptime / 1000)} seconds.`);
        this.process = null;
        return cb();
      });
      return this.process.p.kill();
    } else {
      debug("Stop called with no process running?");
      return cb();
    }
  }

};

//----------

// This is to enable running in dev via coffee. Is it foolproof? Probably not.
streamer_path = args.coffee ? path.resolve(args.dir || __dirname, "./coffee.js") : args.dir ? path.resolve(args.dir, "js/streamer.js") : path.resolve(__dirname, "./streamer.js");

debug(`Streamer path is ${streamer_path}`);

runner = new StreamMachineRunner(streamer_path, args);

_handleExit = function() {
  return runner.terminate(function() {
    debug("StreamMachine Runner exiting.");
    return process.exit();
  });
};

process.on('SIGINT', _handleExit);

process.on('SIGTERM', _handleExit);

process.on('SIGHUP', function() {
  debug("Restart triggered via SIGHUP.");
  return runner.restart();
});

//# sourceMappingURL=runner.js.map
