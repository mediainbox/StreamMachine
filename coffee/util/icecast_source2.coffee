IcecastSource = require "../streammachine/util/icecast_source"

path = require "path"
fs = require "fs"

@args = require("yargs")
    .usage("Usage: $0 --host localhost --port 8001 --stream foo --password abc123 [file]")
    .describe
        host:       "Server"
        port:       "Server source port"
        source:     "Source Mount key"
        password:   "Source password"
        format:     "File Format (mp3 or aac)"
    .demand(["host","port","source","format"])
    .alias('stream','source')
    .default
        host:       "127.0.0.1"
        format:     "mp3"
    .argv

if @args._?[0] == "source"
    @args._.shift()

# -- Make sure they gave us a file -- #

filepath = @args._?[0]

if !filepath
    console.error "A file path is required."
    process.exit(1)

filepath = path.resolve(filepath)

if !fs.existsSync(filepath)
    console.error "File not found."
    process.exit(1)

console.log "file is ", filepath

# -- Start streaming -- #

source = new IcecastSource
    format:     @args.format
    filePath:   filepath
    host:       @args.host
    port:       @args.port
    stream:     @args.stream
    password:   @args.password

source.on "disconnect", =>
    process.exit(1)

source.start (err) =>
    console.log "Streaming!"
