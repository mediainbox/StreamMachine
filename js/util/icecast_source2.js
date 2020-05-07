var IcecastSource, filepath, fs, path, ref, ref1, source;

IcecastSource = require("../coffee/streammachine/util/icecast_source");

path = require("path");

fs = require("fs");

this.args = require("yargs").usage("Usage: $0 --host localhost --port 8001 --stream foo --password abc123 [file]").describe({
  host: "Server",
  port: "Server source port",
  source: "Source Mount key",
  password: "Source password",
  format: "File Format (mp3 or aac)"
}).demand(["host", "port", "source", "format"]).alias('stream', 'source').default({
  host: "127.0.0.1",
  format: "mp3"
}).argv;

if (((ref = this.args._) != null ? ref[0] : void 0) === "source") {
  this.args._.shift();
}

// -- Make sure they gave us a file -- #
filepath = (ref1 = this.args._) != null ? ref1[0] : void 0;

if (!filepath) {
  console.error("A file path is required.");
  process.exit(1);
}

filepath = path.resolve(filepath);

if (!fs.existsSync(filepath)) {
  console.error("File not found.");
  process.exit(1);
}

console.log("file is ", filepath);

// -- Start streaming -- #
source = new IcecastSource({
  format: this.args.format,
  filePath: filepath,
  host: this.args.host,
  port: this.args.port,
  stream: this.args.stream,
  password: this.args.password
});

source.on("disconnect", () => {
  return process.exit(1);
});

source.start((err) => {
  return console.log("Streaming!");
});

//# sourceMappingURL=icecast_source2.js.map
