express = require "express"
debug = require("debug")("sm:util:fake_ad_server")
fs = require "fs"

module.exports = class FakeAdServer extends require("events").EventEmitter
    constructor: (@port,@template,cb) ->
        super()

        # -- read our template -- #

        xmldoc = ""
        debug "Template is #{@template}"
        s = fs.createReadStream @template
        s.on "readable", =>
            xmldoc += r while r = s.read()

        s.once "end", =>
            debug "Template read complete"
            # -- prepare ad server -- #

            @counter = 0

            @app = express()

            @app.get "/impression", (req,res) =>
                req_id = req.query["req_id"]
                @emit "impression", req_id
                res.status(200).end ""

            @app.get "/ad", (req,res) =>
                req_id = @counter
                @counter += 1

                ad = xmldoc
                    .replace("IMPRESSION","http://127.0.0.1:#{@port}/impression?req_id=#{req_id}")

                @emit "ad", req_id
                res.status(200).type("text/xml").end ad

            s = @app.listen @port

            @port = s.address().port if @port == 0

            debug "Setup complete"
            cb? null, @

