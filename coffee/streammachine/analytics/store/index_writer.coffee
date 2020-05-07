debug = require("debug")("sm:analytics:idx_writer")

module.exports = class EsIndexWriter extends require("stream").Writable
    constructor: (@es, @logger) ->
        super objectMode:true

    _write: (batch,encoding,cb) ->
        @logger.debug "_write with batch of #{batch.length}"

        bulk = []

        for obj in batch
            bulk.push index:{_index:obj.index, _type:obj.type}
            bulk.push obj.body

        @es.bulk body:bulk, (err,resp) =>
            if err
                err_str = "Failed to bulk insert #{batch.length} rows: #{err}"
                @logger.error err_str
                return cb()

            @logger.debug "Inserted #{batch.length} rows."
            @emit "bulk"
            cb()
