express = require "express"
fs = require "fs"
path = require "path"

$file = (file) -> path.resolve(__dirname,"..",file)

class PrerollServer
    constructor: (@files,@_on=true) ->
        @app = express()
        @app.get "/:key/:streamkey", (req,res,next) =>
            console.log "Preroll request for #{ req.path }"
            if f = @files[ req.param("key") ]?[ req.param("streamkey") ]
                if @_on

                    res.header "Content-Type", "audio/mpeg"
                    res.status 200

                    stream = fs.createReadStream f
                    stream.pipe(res)
                else
                    # what should we do to test a bad server?
                    setTimeout =>
                        # end unexpectedly
                        res.end()
                    , 3000
            else
                next()

        @app.get "*", (req,res,next) =>
            console.log "Invalid request to #{req.path}"
            next()

        @app.listen process.argv[2]

    toggle: ->
        @_on = !@_on
        console.log "Responses are #{ if @_on then "on" else "off" }"

pre = new PrerollServer
    test:
        "mp3-44100-128-m": $file "test/files/mp3/tone250Hz-44100-128-m.mp3"

process.on "SIGUSR2", ->
    pre.toggle()

console.log "PID is #{process.pid}"
