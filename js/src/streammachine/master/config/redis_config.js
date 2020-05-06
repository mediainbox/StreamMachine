var EventEmitter, MasterConfigRedisStore, debug;

EventEmitter = require('events').EventEmitter;

debug = require("debug")("sm:redis_config");

module.exports = MasterConfigRedisStore = class MasterConfigRedisStore extends EventEmitter {
  constructor(redis) {
    super();
    this.redis = redis;
    process.nextTick(() => {
      return this._config();
    });
  }

  //----------
  _config() {
    return this.redis.once_connected((client) => {
      debug("Querying config from Redis");
      return client.get(this.redis.prefixedKey("config"), (err, reply) => {
        var config;
        if (reply) {
          config = JSON.parse(reply.toString());
          debug("Got redis config of ", config);
          return this.emit("config", config);
        } else {
          return this.emit("config", null);
        }
      });
    });
  }

  //----------
  _update(config, cb) {
    return this.redis.once_connected((client) => {
      debug("Saving configuration to Redis");
      return client.set(this.redis.prefixedKey("config"), JSON.stringify(config), (err, reply) => {
        if (err) {
          debug(`Redis: Failed to save updated config: ${err}`);
          return cb(err);
        } else {
          debug("Set config to ", config, reply);
          return cb(null);
        }
      });
    });
  }

};

//# sourceMappingURL=redis_config.js.map
