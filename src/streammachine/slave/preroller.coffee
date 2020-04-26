_       = require "underscore"
http    = require "http"
url     = require "url"
request = require "request"
xmldom  = require "xmldom"
xpath   = require "xpath"
http    = require "http"

debug = require("debug")("sm:slave:preroller")

module.exports = class Preroller
    constructor: (@stream,@key,@uri,@transcode_uri,@impressionDelay,cb) ->
        @_counter = 1
        @_config = null

        if !@uri || !@transcode_uri
            return cb new Error("Preroller requires Ad URI and Transcoder URI")

        # FIXME: Make these configurable
        @agent = new http.Agent #keepAlive:true, maxSockets:100

        # -- need to look at the stream to get characteristics -- #

        @stream.log.debug "Preroller calling getStreamKey"

        @stream.getStreamKey (@streamKey) =>
            @stream.log.debug "Preroller: Stream key is #{@streamKey}. Ready to start serving."

            @_config =
                key:                @key
                streamKey:          @streamKey
                adURI:              @uri
                transcodeURI:       @transcode_uri
                impressionDelay:    @impressionDelay
                timeout:            2*1000
                agent:              @agent

        cb? null, @

    #----------

    pump: (output,writer,cb) ->
        cb = _.once(cb)
        aborted = false
        # short-circuit if our config isn't set
        if !@_config
            cb new Error("Preroll request without valid config.")
            return true

        # short-circuit if the output has already disconnected
        if output.disconnected
            cb new Error("Preroll request got disconnected output.")
            return true

        count = @_counter++

        # -- create an ad request -- #

        adreq = new Preroller.AdRequest output, writer, @_config, count, (err) =>
            @stream.log.error err if err
            cb()

        adreq.on "error", (err) =>
            @stream.log.error err

    #----------

    class @AdRequest extends require("events").EventEmitter
        constructor: (@output,@writer,@config,@count,@_cb) ->
            @_cb = _.once @_cb

            @_aborted = false
            @_pumping = false

            @_adreq = null
            @_treq  = null
            @_tresp = null

            @_impressionTimeout = null

            # -- Set up an abort listener -- #

            @_abortL = =>
                @debug "conn_pre_abort triggered"
                @_abort null

            @output.once "disconnect", @_abortL

            # -- Set up our ad URI -- #

            @uri = @config.adURI
                .replace("!KEY!", @config.streamKey)
                .replace("!IP!", @output.client.ip)
                .replace("!STREAM!", @config.key)
                .replace("!UA!", encodeURIComponent(@output.client.ua))
                .replace("!UUID!", @output.client.session_id)

            @debug "Ad request URI is #{@uri}"

            # -- Set a timeout -- #

            # If the preroll request can't be completed in time, abort and move on
            @_timeout = setTimeout(=>
                @debug "Preroll request timed out."
                @_abort()
            , @config.timeout)

            # -- Request an ad -- #

            @_requestAd (err,@_ad) =>
                return @_cleanup err if err

                # Now that we have an ad object, we call the transcoder to
                # get a version of the creative that is matched to our specs
                @_requestCreative @_ad, (err) =>
                    return @_cleanup err if err

                    # if we didn't get an error, that means the creative was
                    # successfully piped to our output. We should arm the
                    # impression function
                    @_armImpression @_ad

                    # and trigger our callback
                    @debug "Ad request finished."
                    @_cleanup null

        #----------

        # Request an ad from the ad server
        _requestAd: (cb) ->
            @_adreq = request.get @uri, (err,res,body) =>
                return cb new Error "Ad request returned error: #{err}" if err

                if res.statusCode == 200
                    new Preroller.AdObject body, (err,obj) =>
                        if err
                            cb new Error "Ad request was unsuccessful: #{err}"
                        else
                            cb null, obj
                else
                    cb new Error "Ad request returned non-200 response: #{body}"

        #----------

        # Request transcoded creative from the transcoder
        _requestCreative: (ad,cb) ->
            if !ad.creativeURL
                # if the ad doesn't have a creativeURL, just call back
                # immediately with no error
                return cb null

            @debug "Preparing transcoder request for #{ad.creativeURL} with key #{@config.streamKey}."

            @_treq = request.get(uri:@config.transcodeURI, agent:@config.agent, qs:{ uri:ad.creativeURL, key:@config.streamKey })
                .once "response", (@_tresp) =>
                    @debug "Transcoder response received: #{@_tresp.statusCode}"

                    if @_tresp.statusCode == 200
                        @debug "Piping tresp to writer"
                        @_tresp.pipe(@writer,end:false)
                        @_tresp.once "end", =>
                            @debug "Transcoder sent #{ @_tresp?.socket?.bytesRead || "UNKNOWN" } bytes"
                            #@debug "Writable state is ", @writer._writableState

                            if !@_aborted
                                @debug "Transcoder pipe completed successfully."

                                cb null

                    else
                        cb new Error "Non-200 response from transcoder."
                .once "error", (err) =>
                    cb new Error "Transcoder request error: #{err}"

        #----------

        _armImpression: (ad) ->
            @_impressionTimeout = setTimeout =>
                @output.removeListener "disconnect", disarm

                process.nextTick ->
                    disarm = null
                    @_impressionTimeout = null

                if ad.impressionURL
                   request.get ad.impressionURL, (err,resp,body) =>
                       if err
                           @emit "error", new Error "Failed to hit impression URL #{ad.impressionURL}: #{err}"
                       else
                           @debug "Impression URL hit successfully for #{@output.client.session_id}."
                else
                   @debug "No impression URL found."

            , @config.impressionDelay

            @debug "Arming impression for #{@config.impressionDelay}ms"

            # -- impression abort -- #

            disarm = =>
                @debug "Disarming impression after early abort."
                clearTimeout @_impressionTimeout if @_impressionTimeout

            @output.once "disconnect", disarm

        #----------

        debug: (msg,args...) ->
            debug "#{@count}: " + msg, args...

        #----------

        _abort: (err) ->
            @_aborted = true

            # abort any existing requests
            @_adreq?.abort()
            @_treq?.abort()

            # make sure we don't write any more
            @_tresp?.unpipe()

            @_cleanup err


        _cleanup: (err) ->
            @debug "In _cleanup: #{err}"
            clearTimeout @_timeout if @_timeout
            @output.removeListener "disconnect", @_abortL
            @_cb err

    #----------

    class @AdObject
        constructor: (xmldoc,cb) ->
            @creativeURL    = null
            @impressionURL  = null

            @doc            = null

            debug "Parsing ad object XML"

            doc = new xmldom.DOMParser().parseFromString(xmldoc)

            debug "XML doc parsed."

            # -- VAST Support -- #

            if wrapper = xpath.select("/VAST",doc)?[0]
                debug "VAST wrapper detected"

                if ad = xpath.select("Ad/InLine",wrapper)?[0]
                    debug "Ad document found."

                    # find our linear creative
                    if creative = xpath.select("./Creatives/Creative/Linear",ad)?[0]

                        # find the mpeg mediafile
                        if mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mpeg']/text())",creative)
                            debug "MP3 Media File is #{mediafile}"
                            @creativeURL = mediafile
                        else if mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mp4']/text())",creative)
                            debug "MP4 Media File is #{mediafile}"
                            @creativeURL = mediafile
                        else if mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/aac']/text())",creative)
                            debug "AAC Media File is #{mediafile}"
                            @creativeURL = mediafile

                    # find the impression URL
                    if impression = xpath.select("string(./Impression/text())",ad)
                        debug "Impression URL is #{impression}"
                        @impressionURL = impression

                    return cb null, @

                else
                    # VAST wrapper but no ad
                    return cb null, null

            # -- DAAST Support -- #

            if wrapper = xpath.select("/DAAST",doc)?[0]
                debug "DAAST wrapper detected"

                if ad = xpath.select("Ad/InLine",wrapper)?[0]
                    debug "Ad document found."

                    # find our linear creative
                    if creative = xpath.select("./Creatives/Creative/Linear",ad)?[0]

                        # find the mpeg mediafile
                        if mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mpeg']/text())",creative)
                            debug "MP3 Media File is #{mediafile}"
                            @creativeURL = mediafile
                        else if mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mp4']/text())",creative)
                            debug "MP4 Media File is #{mediafile}"
                            @creativeURL = mediafile


                    # find the impression URL
                    if impression = xpath.select("string(./Impression/text())",ad)
                        debug "Impression URL is #{impression}"
                        @impressionURL = impression

                    return cb null, @

                else
                    # DAAST wrapper but no ad

                    # Is there an error element? If so, we're supposed to hit
                    # it as our impression URL
                    if error = xpath.select("string(./Error/text())",wrapper)
                        debug "Error URL found: #{error}"
                        @impressionURL = error

                        # for a no ad error url, look for an [ERRORCODE] macro
                        # and replace it with 303, because DAAST says so

                        # FIXME: Technically, I think this response is intended
                        # for the case where we had a wrapper and hit that URL
                        # but got no response. We don't support that case yet,
                        # but I think it's ok to send 303 here

                        @impressionURL = @impressionURL.replace("[ERRORCODE]",303)

                        return cb null, @

                    else
                        return cb null, null

            cb new Error "Unsupported ad format"

