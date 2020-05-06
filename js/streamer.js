var Streamer, _, debug, heapdump, nconf, request, streamer;

process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';

if (!process.env.NEW_RELIC_APP_NAME || !process.env.NEW_RELIC_LICENSE_KEY) {
  console.log('[integrations] skipping NewRelic, missing NEW_RELIC_APP_NAME or NEW_RELIC_LICENSE_KEY env vars');
} else {
  console.log('[integrations] loading NewRelic');
  require('newrelic');
}

require('@google-cloud/trace-agent').start({
  projectId: process.env.GCLOUD_PROJECT,
  keyFilename: process.env.GCLOUD_KEY_FILENAME
});

//require('@google-cloud/debug-agent').start
//    projectId: process.env.GCLOUD_PROJECT
//    keyFilename: process.env.GCLOUD_KEY_FILENAME
_ = require("underscore");

nconf = require("nconf");

request = require("request");

debug = require("debug")("sm:master:streamer");

Streamer = class Streamer {
  constructor(config) {
    this.config = config;
    this.mode = nconf.get("mode") || "standalone";
    debug(`Streamer created in mode ${this.mode.toUpperCase()}`);
  }

  //----------
  initialize() {
    return this.getRadio((radio) => {
      this.ping();
      return this.createStreamMachine(radio);
    });
  }

  //----------
  getRadio(callback) {
    debug(`Fetch radio config from ${this.config.uri}`);
    return request.get(this.config.uri, {
      json: true,
      qs: {
        ping: this.mode
      }
    }, (error, response, body) => {
      if (error) {
        debug(error);
        debug("Error ocurred, retrying");
        return this.retry(callback);
      }
      if (!body) {
        debug("No radio available, retrying");
        return this.retry(callback);
      }
      debug("Fetched radio config successfully");
      return callback(body);
    });
  }

  //----------
  retry(callback) {
    return setTimeout(() => {
      debug("Retry");
      return this.getRadio(callback);
    }, this.config.ping / 2);
  }

  //----------
  createStreamMachine(radio1) {
    this.radio = radio1;
    // There are three potential modes of operation:
    // 1) Standalone -- One server, handling boths streams and configuration
    // 2) Master -- Central server in a master/slave setup. Does not handle any streams
    //    directly, but hands out config info to slaves and gets back logging.
    // 3) Slave -- Connects to a master server for stream information.  Passes back
    //    logging data. Offers up stream connections to clients.
    _.defaults(this.radio.options, this.getStreamMachine().Defaults);
    switch (this.mode) {
      case "master":
        return new (this.getStreamMachine()).MasterMode(this.radio.options);
      case "slave":
        return new (this.getStreamMachine()).SlaveMode(this.radio.options);
      default:
        return new (this.getStreamMachine()).StandaloneMode(this.radio.options);
    }
  }

  //----------
  getStreamMachine() {
    this.streamMachine = this.streamMachine || require("./src/streammachine");
    return this.streamMachine;
  }

  //----------
  ping() {
    return setTimeout(() => {
      debug("Ping");
      return request.put(this.config.uri, {
        qs: {
          ping: this.mode,
          name: this.radio.name
        }
      }, () => {
        return this.ping();
      });
    }, this.config.ping);
  }

};

//----------

//----------
nconf.env().argv();

nconf.file({
  file: nconf.get("config") || nconf.get("CONFIG") || "/etc/streammachine.conf"
});

// -- Debugging -- #
// These next two sections are for debugging and use tools that are not included
// as dependencies.
if (nconf.get("enable-heapdump")) {
  console.log("ENABLING HEAPDUMP (trigger via USR2)");
  require("heapdump");
}

if (nconf.get("heapdump-interval")) {
  console.log("ENABLING PERIODIC HEAP DUMPS");
  heapdump = require("heapdump");
  setInterval(() => {
    var file;
    file = `/tmp/streammachine-${process.pid}-${Date.now()}.heapsnapshot`;
    return heapdump.writeSnapshot(file, (err) => {
      if (err) {
        return console.error(err);
      } else {
        return console.error(`Wrote heap snapshot to ${file}`);
      }
    });
  }, Number(nconf.get("heapdump-interval")) * 1000);
}

// -- -- #
streamer = new Streamer(nconf.get());

streamer.initialize();

//# sourceMappingURL=streamer.js.map
