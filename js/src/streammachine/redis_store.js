var Redis, RedisManager, Url, _, debug, nconf;

_ = require('underscore');

Redis = require('redis');

Url = require("url");

nconf = require("nconf");

debug = require("debug")("sm:redis");

module.exports = RedisManager = (function() {
  class RedisManager extends require('events').EventEmitter {
    constructor(opts) {
      var info;
      super();
      this.options = _.defaults(opts, this.DefaultOptions);
      debug(`init redis with ${this.options.server}`);
      info = Url.parse(this.options.server);
      this.client = Redis.createClient(info.port || 6379, info.hostname);
      this.client.once("ready", () => {
        var db, rFunc;
        rFunc = () => {
          this._connected = true;
          return this.emit("connected", this.client);
        };
        // see if there's a config to load
        //@_config()
        if (info.pathname && info.pathname !== "/") {
          // see if there's a database number in the path
          db = Number(info.pathname.substr(1));
          if (isNaN(db)) {
            throw new Error(`Invalid path in Redis URI spec. Expected db number, got '${info.pathname.substr(1)}'`);
          }
          debug(`Redis connecting to DB ${db}`);
          return this.client.select(db, (err) => {
            if (err) {
              throw new Error(`Redis DB select error: ${err}`);
            }
            this._db = db;
            return rFunc();
          });
        } else {
          this._db = 0;
          debug("Redis using DB 0.");
          return rFunc();
        }
      });
    }

    //----------
    prefixedKey(key) {
      if (this.options.key) {
        return `${this.options.key}:${key}`;
      } else {
        return key;
      }
    }

    //----------
    once_connected(cb) {
      if (this._connected) {
        return typeof cb === "function" ? cb(this.client) : void 0;
      } else {
        return this.once("connected", cb);
      }
    }

  };

  RedisManager.prototype.DefaultOptions = {
    server: "redis://localhost:6379",
    key: "StreamMachine"
  };

  return RedisManager;

}).call(this);

//# sourceMappingURL=redis_store.js.map
