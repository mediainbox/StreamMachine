const EventEmitter = require('events').EventEmitter;

module.exports = class MasterConfigRedisStore extends EventEmitter {
  constructor(ctx) {
    super();

    this.logger = ctx.logger.child({
      component: 'redis_config'
    });
    this.redis = ctx.providers.redis;

    process.nextTick(() => {
      this._config();
    });
  }

  _config() {
    return this.redis.once_connected((client) => {
      debug("Querying config from Redis");
      return client.get(this.redis.prefixedKey("config"), (err, reply) => {
        var config;
        if (reply) {
          config = JSON.parse(reply.toString());
          this.logger.debug("got redis config", { config });
          return this.emit("config", config);
        } else {
          return this.emit("config", null);
        }
      });
    });
  }

  _update(config, cb) {
    return this.redis.once_connected((client) => {
      debug("Saving configuration to Redis");
      return client.set(this.redis.prefixedKey("config"), JSON.stringify(config), (err, reply) => {
        if (err) {
          this.logger.debug(`Redis: Failed to save updated config: ${err}`);
          return cb(err);
        } else {
          this.logger.debug("Set config to ", config, reply);
          return cb(null);
        }
      });
    });
  }
};
