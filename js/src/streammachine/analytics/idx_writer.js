var IdxWriter, debug,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

debug = require("debug")("sm:analytics:idx_writer");

module.exports = IdxWriter = (function(_super) {
  __extends(IdxWriter, _super);

  function IdxWriter(es, log) {
    this.es = es;
    this.log = log;
    IdxWriter.__super__.constructor.call(this, {
      objectMode: true
    });
    this.log.debug("IdxWriter init");
  }

  IdxWriter.prototype._write = function(batch, encoding, cb) {
    var bulk, obj, _i, _len;
    this.log.debug("_write with batch of " + batch.length);
    bulk = [];
    for (_i = 0, _len = batch.length; _i < _len; _i++) {
      obj = batch[_i];
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
    }, (function(_this) {
      return function(err, resp) {
        var err_str;
        if (err) {
          err_str = "Failed to bulk insert " + batch.length + " rows: " + err;
          _this.log.error(err_str);
          return cb();
        }
        _this.log.debug("Inserted " + batch.length + " rows.");
        _this.emit("bulk");
        return cb();
      };
    })(this));
  };

  return IdxWriter;

})(require("stream").Writable);

//# sourceMappingURL=idx_writer.js.map
