var EsIndexWriter, debug;

debug = require("debug")("sm:analytics:idx_writer");

module.exports = EsIndexWriter = class EsIndexWriter extends require("stream").Writable {
  constructor(es, logger) {
    super({
      objectMode: true
    });
    this.es = es;
    this.logger = logger;
  }

  _write(batch, encoding, cb) {
    var bulk, i, len, obj;
    this.logger.debug(`_write with batch of ${batch.length}`);
    bulk = [];
    for (i = 0, len = batch.length; i < len; i++) {
      obj = batch[i];
      bulk.push({
        index: {
          _index: obj.index,
          _type: obj.type
        }
      });
      bulk.push(obj.body);
    }
    return this.es.bulk({
      body: bulk
    }, (err, resp) => {
      var err_str;
      if (err) {
        err_str = `Failed to bulk insert ${batch.length} rows: ${err}`;
        this.logger.error(err_str);
        return cb();
      }
      this.logger.debug(`Inserted ${batch.length} rows.`);
      this.emit("bulk");
      return cb();
    });
  }

};
