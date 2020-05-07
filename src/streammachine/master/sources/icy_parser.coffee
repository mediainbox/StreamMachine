module.exports = class IcyParser extends require("events").EventEmitter
        constructor: (type) ->
            super()

            @["INIT_"+type]()
            @offset = 0

        @REQUEST:    "REQUEST"
        @RESPONSE:   "RESPONSE"

        reinitialize: @

        execute: (@chunk) ->
            @offset = 0
            @end = @chunk.length

            while @offset < @end
                @[@state]()
                @offset++;

            true

        INIT_REQUEST: ->
            @state = "REQUEST_LINE"
            @lineState = "DATA"
            @info = headers:{}

        consumeLine: ->
            @captureStart = @offset if !@captureStart?

            byte = @chunk[@offset]
            if byte == 0x0d && @lineState == "DATA" # \r
                @captureEnd = @offset
                @lineState = "ENDING"
                return

            if @lineState == "ENDING"
                @lineState = "DATA"
                return if byte != 0x0a

                line = @chunk.toString "ascii", @captureStart, @captureEnd

                @captureStart = undefined
                @captureEnd = undefined

                return line

        requestExp: /^([A-Z]+) (.*) (ICE|HTTP)\/(1).(0|1)$/;

        REQUEST_LINE: ->
            line = @consumeLine()

            return if !line?

            match = @requestExp.exec line

            if match
                [@info.method,@info.url,@info.protocol,@info.versionMajor,@info.versionMinor] = match[1..5]
            else
                # this isn't a request line that we understand... we should
                # close the connection
                @emit "invalid"

            @info.request_offset = @offset
            @info.request_line = line

            @state = "HEADER"

        headerExp: /^([^:]+): *(.*)$/

        HEADER: ->
            line = @consumeLine()

            return if !line?

            if line
                match = @headerExp.exec line
                @info.headers[match[1].toLowerCase()] = match[2]
            else
                @emit "headersComplete", @info.headers
