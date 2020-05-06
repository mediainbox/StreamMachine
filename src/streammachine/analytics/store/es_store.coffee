
elasticsearch = require "@elastic/elasticsearch"

BatchedQueue    = require "../util/batched_queue"
EsIndexWriter   = require "./store/idx_writer"
ESTemplates     = require "./store/es_templates"

module.exports = class AnalyticsEsStore
    constructor: (@opts,cb) ->
        @_uri = URL.parse @opts.config.es_uri

        @log = @opts.log

        @_timeout_sec = Number(@opts.config.finalize_secs)

        if @opts.redis

            @redis = @opts.redis.client

        es_uri = @opts.config.es_uri
        @idx_prefix = @opts.config.es_prefix

        @log.debug "Connecting to Elasticsearch at #{es_uri} with prefix of #{@idx_prefix}"
        debug "Connecting to ES at #{es_uri}, prefix #{@idx_prefix}"

        apiVersion = '1.7'
        if (typeof @opts.config.es_api_version != 'undefined')
            apiVersion = @opts.config.es_api_version.toString()

        @es = new elasticsearch.Client
            node:           es_uri
            apiVersion:     apiVersion
            requestTimeout: @opts.config.request_timeout || 30000

        @idx_batch  = new BatchedQueue
            batch:      @opts.config.index_batch
            latency:    @opts.config.index_latency

        @idx_writer = new EsIndexWriter @es, @log.child(submodule:"idx_writer")
        @idx_writer.on "error", (err) =>
            @log.error err

        @idx_batch.pipe(@idx_writer)

        # track open sessions
        @sessions = {}

        @local = tz(require "timezone/zones")(nconf.get("timezone")||"UTC")

        # -- Load our Templates -- #

        @_loadTemplates (err) =>
            if err
                console.error err
                cb? err
            else
    # do something...
                debug "Hitting cb after loading templates"
                cb? null, @

    #----------

    _storeSession: (session,cb) ->
# write one index per day of data
        index_date = tz(session.time,"%F")
        @es.index index:"#{@idx_prefix}-sessions-#{index_date}", type: '_doc', body:session, (err) =>
            return cb new Error "Error creating index #{@idx_prefix}-sessions-#{index_date} #{err}" if err

#----------

    _selectSessionStart: (id,cb) ->
# -- Look up user information from session_start -- #

        body =
            query:
                bool:
                    must: [
                        {
                            match:
                                "session_id": id
                        },
                        {
                            match:
                                "type": "start"
                        }
                    ]
            sort:
                time:{order:"desc"}
            size: 1

        # session start is allowed to be anywhere in the last 24 hours
        @_indicesForTimeRange "listens", new Date(), "-72 hours", (err,indices) =>
            @es.search body:body, index:indices, ignoreUnavailable:true, (err,res) =>
                return cb new Error "Error querying session start for #{id}: #{err}" if err

                if res.body.hits && res.body.hits.total.value > 0
                    cb null, _.extend {}, res.body.hits.hits[0]._source, time:new Date(res.body.hits.hits[0]._source.time)

#----------

    _selectPreviousSession: (sessionId, cb) ->
    # -- Have we ever finalized this session id? -- #

        body =
            query:
                bool:
                    must: [
                        {
                            match:
                                "session_id": sessionId
                        },
                        {
                            match:
                                "type": "session"
                        }
                    ]
            sort:
                time: {order:"desc"}
            size:1


        @_indicesForTimeRange "sessions", new Date(), "-72 hours", (err,indices) =>
            @es.search body:body, index:indices, ignoreUnavailable:true, (err,res) =>
                return cb new Error "Error querying for old session #{id}: #{err}" if err

                if !res.body.hits || res.body.hits.total.value == 0
                    cb null, null
                else
                    cb null, new Date(res.body.hits.hits[0]._source.time)



#----------

    _selectListenTotals: (id,ts,cb) ->
# -- Query total duration and kbytes sent -- #

        filter =
            if ts
                "and":
                    filters:[
                        { range:{ time:{ gt:ts } } },
                        { term:{session_id:id} },
                        { term:{type:"listen"}}
                    ]
            else
                term:{session_id:id}

        body =
            query:
                constant_score:
                    filter:filter
            aggs:
                duration:
                    sum:{ field:"duration" }
                kbytes:
                    sum:{ field:"kbytes" }
                last_listen:
                    max:{ field:"time" }

        @_indicesForTimeRange "listens", new Date(), ts||"-72 hours", (err,indices) =>
            @es.search index:indices, body:body, ignoreUnavailable:true, (err,res) =>
                return cb new Error "Error querying listens to finalize session #{id}: #{err}" if err

                if res.body.hits.total.value > 0
                    cb null,
                        requests:       res.body.hits.total.value
                        duration:       res.body.aggregations.duration.value
                        kbytes:         res.body.aggregations.kbytes.value
                        last_listen:    new Date(res.body.aggregations.last_listen.value)
                else
                    cb null, null


#----------

    countListeners: (cb) ->
# -- Query recent listeners -- #

        body =
            query:
                constant_score:
                    filter:
                        range:
                            time:
                                gt:"now-15m"
            size:0
            aggs:
                listeners_by_minute:
                    date_histogram:
                        field:      "time"
                        fixed_interval:   "1m"
                    aggs:
                        duration:
                            sum:{ field:"duration" }
                        sessions:
                            cardinality:{ field:"session_id" }
                        streams:
                            terms:{ field:"stream", size:50 }

        @_indicesForTimeRange "listens", new Date(), "-15 minutes", (err,indices) =>
            @es.search index:indices, body:body, ignoreUnavailable:true, (err,res) =>
                return cb new Error "Failed to query listeners: #{err}" if err

                times = []

                if !res.body.aggregations
                    cb null, times
                    return

                for obj in res.body.aggregations.listeners_by_minute.buckets
                    streams = {}
                    for sobj in obj.streams.buckets
                        streams[ sobj.key ] = sobj.doc_count

                    times.unshift
                        time:               @local(new Date(obj.key),"%F %T%^z")
                        requests:           obj.doc_count
                        avg_listeners:      Math.round( obj.duration.value / 60 )
                        sessions:           obj.sessions.value
                        requests_by_stream: streams

                cb null, times

    #----------


    _indicesForTimeRange: (idx, start, end, cb) ->
        if _.isFunction(end)
            cb = end
            end = null

        start = @local(start)

        if _.isString(end) && end[0] == "-"
            end = @local(start,end)

        indices = []
        if end
            end = @local(end)

            s = start
            while true
                s = @local(s,"-1 day")
                break if s < end
                indices.push "#{@idx_prefix}-#{idx}-#{ @local(s,"%F") }"

        indices.unshift "#{@idx_prefix}-#{idx}-#{ @local(start,"%F") }"
        cb null, _.uniq(indices)


    #----------


    _loadTemplates: (cb) ->
        errors = []

        debug "Loading #{Object.keys(ESTemplates).length} ElasticSearch templates"

        _loaded = _.after Object.keys(ESTemplates).length, =>
            if errors.length > 0
                debug "Failed to load one or more ElasticSearch templates: #{errors.join(" | ")}"
                @log.info errors
                cb new Error "Failed to load index templates: #{ errors.join(" | ") }"
            else
                debug "ES templates loaded successfully."
                cb null

        for t,obj of ESTemplates
            debug "Loading ElasticSearch mapping for #{@idx_prefix}-#{t}"
            #@log.info "Loading Elasticsearch mappings for #{@idx_prefix}-#{t}"
            tmplt = _.extend {}, obj, index_patterns:"#{@idx_prefix}-#{t}-*"
            #@log.info tmplt
            @es.indices.putTemplate name:"#{@idx_prefix}-#{t}-template", body:tmplt, (err) =>
                errors.push err if err
                _loaded()
