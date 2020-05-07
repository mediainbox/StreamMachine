var FakeAdServer, filepath, fs, path, ref;

path = require("path");

fs = require("fs");

FakeAdServer = require("../coffee/streammachine/util/fake_ad_server");

this.args = require("yargs").usage("Usage: $0 --template ./test/files/ads/vast.xml --port 8002").describe({
  template: "XML Ad Template",
  port: "Ad server port"
}).demand(["template", "port"]).default({
  port: 0
}).argv;

if (((ref = this.args._) != null ? ref[0] : void 0) === "fake_ad_server") {
  this.args._.shift();
}

// -- Make sure they gave us a template file -- #
filepath = path.resolve(this.args.template);

if (!fs.existsSync(this.args.template)) {
  console.error("Template file not found.");
  process.exit(1);
}

// -- Set up our fake server -- #
new FakeAdServer(this.args.port, filepath, (err, s) => {
  console.error(`Ad server is listening on port ${s.port}`);
  return s.on("request", (obj) => {
    return console.error("Request: ", obj);
  });
});

//# sourceMappingURL=fake_ad_server.js.map
