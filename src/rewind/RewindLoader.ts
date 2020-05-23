import { Readable } from "stream";
const Dissolve = require("dissolve");

function buildParser() {
  return Dissolve().uint32le("header_length").tap(function (this: any) {
    this.buffer("header", this.vars.header_length).tap(function (this: any) {
      this.push(JSON.parse(this.vars.header));
      this.vars = {};
      this.loop(function (this: any) {
        this.uint8("meta_length").tap(function (this: any) {
          this.buffer("meta", this.vars.meta_length).uint16le("data_length").tap(function (this: any) {
            this.buffer("data", this.vars.data_length).tap(function (this: any) {
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

export function createRewindLoader(binarySource: Readable) {
  return binarySource.pipe(buildParser());
}
