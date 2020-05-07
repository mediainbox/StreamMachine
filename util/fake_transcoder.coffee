path = require "path"
fs = require "fs"

FakeTranscoder = require "../coffee/streammachine/util/fake_transcoder"

@args = require("yargs")
    .usage("Usage: $0 --dir ./test/files/mp3 --port 8001")
    .describe
        dir:        "Directory with audio files"
        port:       "Transcoder server port"
    .demand(["dir","port"])
    .default
        port:       0
    .argv

if @args._?[0] == "fake_transcoder"
    @args._.shift()

# -- Make sure they gave us a file -- #

filepath = path.resolve(@args.dir)

if !fs.existsSync(@args.dir)
    console.error "Files directory not found."
    process.exit(1)

console.log "Files dir is ", filepath

# -- Set up our fake server -- #

s = new FakeTranscoder @args.port, filepath

console.error "Transcoding server is listening on port #{ s.port }"

s.on "request", (obj) =>
    console.error "Request: ", obj
