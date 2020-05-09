/*
require('@google-cloud/trace-agent').start
    projectId: process.env.GCLOUD_PROJECT
    keyFilename: process.env.GCLOUD_KEY_FILENAME
*/

process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';
if (process.env.NEW_RELIC_APP_NAME && process.env.NEW_RELIC_LICENSE_KEY) {
  console.log('[integrations] loading NewRelic');
  require('newrelic');
}

const _ = require("lodash");
const nconf = require("nconf");
const axios = require("axios");
const debug = require("debug")("sm:streamer");
const StreamMachine = require("./streammachine");

class Streamer {
  constructor(config1) {
    this.mode = nconf.get("mode");
    this.config = config1;
  }

  initialize() {
    return this.readConfig((config) => {
      return this.createStreamMachine(config);
    });
  }

  readConfig(callback) {
    if (this.config.client) {
      debug(`using local config: ${this.config.config}`);
      callback(this.config);
      return;
    }
    if (!this.config.uri) {
      throw new Error('No remote config URL supplied in config file');
    }

    debug(`fetch remote config from ${this.config.uri}`);
    return axios.get(this.config.uri, {
      params: {
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

      this.ping();

      return callback(body);
    });
  }

  retry(callback) {
    return setTimeout(() => {
      debug("Retry");
      return this.readConfig(callback);
    }, this.config.ping / 2);
  }

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

  ping() {
    return setTimeout(() => {
      _.throttle(() => {
        return debug("Ping", 10000);
      });
      return axios.put(this.config.uri, {
        params: {
          ping: this.mode,
          name: this.config.name
        }
      }, () => {
        return this.ping();
      });
    }, this.config.ping);
  }
}

nconf.env().argv();
nconf.file({
  file: nconf.get("config") || nconf.get("CONFIG") || "/etc/streammachine.conf"
});

new Streamer(nconf.get()).initialize();
