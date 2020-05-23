var FakeTranscoder, filepath, fs, path, ref, s;

path = require("path");

fs = require("fs");

FakeTranscoder = require("./util/fake_transcoder");

this.args = require("yargs").usage("Usage: $0 --dir ./test/files/mp3 --port 8001").describe({
  dir: "Directory with audio files",
  port: "Transcoder server port"
}).demand(["dir", "port"]).default({
  port: 0
}).argv;

if (((ref = this.args._) != null ? ref[0] : void 0) === "fake_transcoder") {
  this.args._.shift();
}

// -- Make sure they gave us a file -- #
filepath = path.resolve(this.args.dir);

if (!fs.existsSync(this.args.dir)) {
  console.error("Files directory not found.");
  process.exit(1);
}

console.log("Files dir is ", filepath);

// -- Set up our fake server -- #
s = new FakeTranscoder(this.args.port, filepath);

console.error(`Transcoding server is listening on port ${s.port}`);

s.on("request", (obj) => {
  return console.error("Request: ", obj);
});
