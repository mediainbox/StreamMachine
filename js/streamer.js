var Streamer, debug, heapdump, nconf, request, streamer, _;

require('@google-cloud/trace-agent').start({
  projectId: process.env.GCLOUD_PROJECT,
  keyFilename: process.env.GCLOUD_KEY_FILENAME
});

require('@google-cloud/debug-agent').start({
  projectId: process.env.GCLOUD_PROJECT,
  keyFilename: process.env.GCLOUD_KEY_FILENAME
});

_ = require("underscore");

nconf = require("nconf");

request = require("request");

debug = require("debug")("sm:master:streamer");

Streamer = (function() {
  function Streamer(config) {
    this.config = config;
    this.mode = nconf.get("mode") || "standalone";
    debug("Created as " + this.mode);
  }

  Streamer.prototype.initialize = function() {
    return this.getRadio((function(_this) {
      return function(radio) {
        _this.ping();
        return _this.createStreamMachine(radio);
      };
    })(this));
  };

  Streamer.prototype.getRadio = function(callback) {
    return request.get(this.config.uri, {
      json: true,
      qs: {
        ping: this.mode
      }
    }, (function(_this) {
      return function(error, response, body) {
        if (error) {
          debug(error);
          return _this.retry(callback);
        }
        if (!body) {
          debug("No radio available");
          return _this.retry(callback);
        }
        return callback(body);
      };
    })(this));
  };

  Streamer.prototype.retry = function(callback) {
    return setTimeout((function(_this) {
      return function() {
        debug("Retry");
        return _this.getRadio(callback);
      };
    })(this), this.config.ping / 2);
  };

  Streamer.prototype.createStreamMachine = function(radio) {
    this.radio = radio;
    _.defaults(this.radio.options, this.getStreamMachine().Defaults);
    switch (this.mode) {
      case "master":
        return new (this.getStreamMachine()).MasterMode(this.radio.options);
      case "slave":
        return new (this.getStreamMachine()).SlaveMode(this.radio.options);
      default:
        return new (this.getStreamMachine()).StandaloneMode(this.radio.options);
    }
  };

  Streamer.prototype.getStreamMachine = function() {
    this.streamMachine = this.streamMachine || require("./src/streammachine");
    return this.streamMachine;
  };

  Streamer.prototype.ping = function() {
    return setTimeout((function(_this) {
      return function() {
        debug("Ping");
        return request.put(_this.config.uri, {
          qs: {
            ping: _this.mode,
            name: _this.radio.name
          }
        }, function() {
          return _this.ping();
        });
      };
    })(this), this.config.ping);
  };

  return Streamer;

})();

nconf.env().argv();

nconf.file({
  file: nconf.get("config") || nconf.get("CONFIG") || "/etc/streammachine.conf"
});

if (nconf.get("enable-heapdump")) {
  console.log("ENABLING HEAPDUMP (trigger via USR2)");
  require("heapdump");
}

if (nconf.get("heapdump-interval")) {
  console.log("ENABLING PERIODIC HEAP DUMPS");
  heapdump = require("heapdump");
  setInterval((function(_this) {
    return function() {
      var file;
      file = "/tmp/streammachine-" + process.pid + "-" + (Date.now()) + ".heapsnapshot";
      return heapdump.writeSnapshot(file, function(err) {
        if (err) {
          return console.error(err);
        } else {
          return console.error("Wrote heap snapshot to " + file);
        }
      });
    };
  })(this), Number(nconf.get("heapdump-interval")) * 1000);
}

streamer = new Streamer(nconf.get());

streamer.initialize();

//# sourceMappingURL=streamer.js.map
