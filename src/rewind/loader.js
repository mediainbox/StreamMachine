const Dissolve = require("dissolve");
const { PassThrough } = require('stream');

function buildParser() {
  return Dissolve().uint32le("header_length").tap(function () {
    this.buffer("header", this.vars.header_length).tap(function () {
      this.push(JSON.parse(this.vars.header));
      this.vars = {};
      this.loop(function (end) {
        this.uint8("meta_length").tap(function () {
          this.buffer("meta", this.vars.meta_length).uint16le("data_length").tap(function () {
            this.buffer("data", this.vars.data_length).tap(function () {
              var meta;
              meta = JSON.parse(this.vars.meta.toString());
              this.push({
                ts: new Date(meta.ts),
                meta: meta.meta,
                duration: meta.duration,
                data: this.vars.data
              });
              this.vars = {};
            });
          });
        });
      });
    });
  })
}

function createRewindLoader(binarySource) {
  return binarySource.pipe(buildParser());
}

module.exports = {
  createRewindLoader
}
