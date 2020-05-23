path = require "path"
fs = require "fs"

FakeAdServer = require "../streammachine/util/fake_ad_server"

@args = require("yargs")
    .usage("Usage: $0 --template ./test/files/ads/vast.xml --port 8002")
    .describe
        template:   "XML Ad Template"
        port:       "Ad server port"
    .demand(["template","port"])
    .default
        port:       0
    .argv

if @args._?[0] == "fake_ad_server"
    @args._.shift()

# -- Make sure they gave us a template file -- #

filepath = path.resolve(@args.template)

if !fs.existsSync(@args.template)
    console.error "Template file not found."
    process.exit(1)

# -- Set up our fake server -- #

new FakeAdServer @args.port, filepath, (err,s) =>
    console.error "Ad server is listening on port #{ s.port }"

    s.on "request", (obj) =>
        console.error "Request: ", obj
