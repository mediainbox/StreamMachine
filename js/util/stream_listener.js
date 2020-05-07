var StreamListener, argv, listener, ref;

StreamListener = require("../coffee/streammachine/util/stream_listener");

argv = require("yargs").usage("Usage: $0 --host localhost --port 8001 --stream foo --shoutcast").help('h').alias('h', 'help').describe({
  host: "Server",
  port: "Port",
  stream: "Stream Key",
  shoutcast: "Include 'icy-metaint' header?"
}).default({
  shoutcast: false
}).boolean(['shoutcast']).demand(["host", "port", "stream"]).argv;

if (((ref = argv._) != null ? ref[0] : void 0) === "listener") {
  argv._.shift();
}

listener = new StreamListener(argv.host, argv.port, argv.stream, argv.shoutcast);

listener.connect((err) => {
  if (err) {
    console.error(`ERROR: ${err}`);
    return process.exit(1);
  } else {
    return console.error("Connected.");
  }
});

setInterval(() => {
  return console.error(`${listener.bytesReceived} bytes.`);
}, 5000);

process.on("SIGINT", () => {
  console.error("Disconnecting...");
  return listener.disconnect(() => {
    console.error(`Disconnected. ${listener.bytesReceived} total bytes.`);
    return process.exit();
  });
});

//# sourceMappingURL=stream_listener.js.map
