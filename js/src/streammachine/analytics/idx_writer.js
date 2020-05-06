var IdxWriter, debug;

debug = require("debug")("sm:analytics:idx_writer");

module.exports = IdxWriter = class IdxWriter extends require("stream").Writable {
  constructor(es, log) {
    super({
      objectMode: true
    });
    this.es = es;
    this.log = log;
    this.log.debug("IdxWriter init");
  }

  _write(batch, encoding, cb) {
    var bulk, i, len, obj;
    this.log.debug(`_write with batch of ${batch.length}`);
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
        this.log.error(err_str);
        return cb();
      }
      this.log.debug(`Inserted ${batch.length} rows.`);
      this.emit("bulk");
      return cb();
    });
  }

};

//# sourceMappingURL=idx_writer.js.map
