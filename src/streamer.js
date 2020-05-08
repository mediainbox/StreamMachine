/*
require('@google-cloud/trace-agent').start
    projectId: process.env.GCLOUD_PROJECT
    keyFilename: process.env.GCLOUD_KEY_FILENAME
*/
var StreamMachine, Streamer, _, debug, heapdump, nconf, request, streamer;

process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';

if (process.env.NEW_RELIC_APP_NAME && process.env.NEW_RELIC_LICENSE_KEY) {
  console.log('[integrations] loading NewRelic');
  require('newrelic');
}

//require('@google-cloud/debug-agent').start
//    projectId: process.env.GCLOUD_PROJECT
//    keyFilename: process.env.GCLOUD_KEY_FILENAME
_ = require("lodash");

nconf = require("nconf");

request = require("request");

debug = require("debug")("sm:streamer");

StreamMachine = require("./streammachine");

Streamer = class Streamer {
  constructor(config1) {
    this.mode = nconf.get("mode");
    this.config = config1;
  }

  //----------
  initialize() {
    return this.readConfig((config) => {
      this.ping();
      return this.createStreamMachine(config);
    });
  }

  //----------
  readConfig(callback) {
    if (this.config.client) {
      debug(`using local config: ${this.config.config}`);
      callback(this.config);
      return;
    }
    if (!this.config.uri) {
      throw new Error('No remote config URL supplied in config file');
    }
    debug(`fetch remove config from ${this.config.uri}`);
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
      return this.readConfig(callback);
    }, this.config.ping / 2);
  }

  //----------
  createStreamMachine(config1) {
    this.config = config1;
    // There are three potential modes of operation:
    // 1) Standalone -- One server, handling boths streams and configuration
    // 2) Master -- Central server in a master/slave setup. Does not handle any streams
    //    directly, but hands out config info to slaves and gets back logging.
    // 3) Slave -- Connects to a master server for stream information.  Passes back
    //    logging data. Offers up stream connections to clients.
    _.defaults(this.config.options, StreamMachine.Defaults);
    this.mode = nconf.get("mode") || this.config.options.mode;
    switch (this.mode) {
      case "master":
        return new StreamMachine.Modes.MasterMode(this.config.options);
      case "slave":
        return new StreamMachine.Modes.SlaveMode(this.config.options);
      default:
        return new StreamMachine.Modes.StandaloneMode(this.config.options);
    }
  }

  //----------
  ping() {
    return setTimeout(() => {
      _.throttle(() => {
        return debug("Ping", 10000);
      });
      return request.put(this.config.uri, {
        qs: {
          ping: this.mode,
          name: this.config.name
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
