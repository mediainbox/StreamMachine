var PasswordHash, Users;

PasswordHash = require("password-hash");

module.exports = Users = (function() {
  class Users {
    constructor() {
      this._user_lookup = (user, password, cb) => {
        return typeof cb === "function" ? cb("Cannot look up users without a valid store loaded.") : void 0;
      };
      this._user_store = (user, password, cb) => {
        return typeof cb === "function" ? cb("Cannot store users without a valid store loaded.") : void 0;
      };
      this._user_list = (cb) => {
        return typeof cb === "function" ? cb("Cannot list users without a valid store loaded.") : void 0;
      };
    }

    list(cb) {
      return this._user_list(cb);
    }

    validate(user, password, cb) {
      return this._user_lookup(user, password, cb);
    }

    store(user, password, cb) {
      return this._user_store(user, password, cb);
    }

  };

  //-----------
  Users.Local = class Local extends Users {
    constructor(ctx) {
      var nconf;
      super();
      this.ctx = ctx;
      if (this.ctx.providers.redis != null) {
        // we're using redis for users
        this._user_list = (cb) => {
          return this.ctx.providers.redis.once_connected((redis) => {
            return redis.hkeys("users", cb);
          });
        };
        this._user_lookup = (user, password, cb) => {
          return this.ctx.providers.redis.once_connected((redis) => {
            return redis.hget("users", user, (err, val) => {
              if (err) {
                if (typeof cb === "function") {
                  cb(err);
                }
                return false;
              }
              // see if the hashed passwords match
              if (PasswordHash.verify(password, val)) {
                return typeof cb === "function" ? cb(null, true) : void 0;
              } else {
                return typeof cb === "function" ? cb(null, false) : void 0;
              }
            });
          });
        };
        this._user_store = (user, password, cb) => {
          return this.ctx.providers.redis.once_connected((redis) => {
            var hashed;
            console.log("in user_store for ", user, password);
            if (password) {
              // store the user
              hashed = PasswordHash.generate(password);
              console.log("hashed pass is ", hashed);
              return redis.hset("users", user, hashed, (err, result) => {
                if (err) {
                  if (typeof cb === "function") {
                    cb(err);
                  }
                  return false;
                }
                return typeof cb === "function" ? cb(null, true) : void 0;
              });
            } else {
              // delete the user
              return redis.hdel("users", user, (err) => {
                if (err) {
                  if (typeof cb === "function") {
                    cb(err);
                  }
                  return false;
                }
                return typeof cb === "function" ? cb(null, true) : void 0;
              });
            }
          });
        };
      } else {
        // we need to pull users out of the config file
        nconf = require("nconf");
        this._user_list = (cb) => {
          var users;
          users = nconf.get("users");
          if (users) {
            return typeof cb === "function" ? cb(null, Object.keys(users)) : void 0;
          } else {
            return typeof cb === "function" ? cb(null, []) : void 0;
          }
        };
        this._user_lookup = (user, password, cb) => {
          var hash;
          if (hash = nconf.get(`users:${user}`)) {
            return typeof cb === "function" ? cb(null, PasswordHash.verify(password, hash)) : void 0;
          } else {
            return typeof cb === "function" ? cb(null, false) : void 0;
          }
        };
        this._user_store = (user, password, cb) => {
          return typeof cb === "function" ? cb("Cannot store passwords when not using Redis.") : void 0;
        };
      }
    }

  };

  return Users;

}).call(this);
