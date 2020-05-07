var Analytics, URL, _, debug, nconf, tz, winston;

_ = require("underscore");

URL = require("url");

winston = require("winston");

tz = require("timezone");

nconf = require("nconf");

debug = require("debug")("sm:analytics");

// This module is responsible for:

// * Listen for session_start and listen interactions
// * Watch for sessions that are no longer active.  Finalize them, attaching
//   stats and duration, and throwing out sessions that did not meet minimum
//   requirements
// * Answer questions about current number of listeners at any given time
module.exports = Analytics = class Analytics {
  constructor(ctx) {
    this.ctx = ctx;
    this.logger = this.ctx.logger.child({
      component: "analytics"
    });
    this.config = this.ctx.config.analytics;
    this._timeout_sec = Number(this.config.finalize_secs);
    if (this.ctx.providers.redis) {
      this.redis = this.ctx.providers.redis;
    }
    // track open sessions
    this.sessions = {};
    this.local = tz(require("timezone/zones"))(nconf.get("timezone") || "UTC");
    // -- are there any sessions that should be finalized? -- #
    // when was our last finalized session?
    //last_session = @influx.query "SELECT max(time) from sessions", (err,res) =>
    //    console.log "last session is ", err, res
    // what sessions have we seen since then?

    // -- Redis Session Sweep -- #
    if (this.redis) {
      this.logger.info("Analytics setting up Redis session sweeper");
      setInterval(() => {
        // look for sessions that should be written (score less than now)
        return this.redis.zrangebyscore("session-timeouts", 0, Math.floor(Number(new Date()) / 1000), (err, sessions) => {
          var _sFunc;
          if (err) {
            return this.logger.error(`Error fetching sessions to finalize: ${err}`);
          }
          _sFunc = () => {
            var s;
            if (s = sessions.shift()) {
              this._triggerSession(s);
              return _sFunc();
            }
          };
          return _sFunc();
        });
      }, 5 * 1000);
    }
  }

  //----------
  _log(obj, cb) {
    var index_date, ref, ref1, session_id, time;
    session_id = null;
    if (!((ref = obj.client) != null ? ref.session_id : void 0)) {
      if (typeof cb === "function") {
        cb(new Error("Object does not contain a session ID"));
      }
      return false;
    }
    // write one index per day of data
    index_date = tz(obj.time, "%F");
    time = new Date(obj.time);
    // clean up IPv4 IP addresses stuck in IPv6
    if ((ref1 = obj.client) != null ? ref1.ip : void 0) {
      obj.client.ip = obj.client.ip.replace(/^::ffff:/, "");
    }
    return this._indicesForTimeRange("listens", time, (err, idx) => {
      switch (obj.type) {
        case "session_start":
          this.idx_batch.write({
            index: idx[0],
            body: {
              time: new Date(obj.time),
              session_id: obj.client.session_id,
              stream: obj.stream_group || obj.stream,
              client: obj.client,
              type: "start"
            }
          });
          if (typeof cb === "function") {
            cb(null);
          }
          break;
        // -- start tracking the session -- #
        case "listen":
          // do we know of other duration for this session?
          this._getStashedDurationFor(obj.client.session_id, obj.duration, (err, dur) => {
            this.idx_batch.write({
              index: idx[0],
              body: {
                session_id: obj.client.session_id,
                time: new Date(obj.time),
                kbytes: obj.kbytes,
                duration: obj.duration,
                session_duration: dur,
                stream: obj.stream,
                client: obj.client,
                offsetSeconds: obj.offsetSeconds,
                contentTime: obj.contentTime,
                type: "listen"
              }
            });
            return typeof cb === "function" ? cb(null) : void 0;
          });
      }
      // -- update our timer -- #
      return this._updateSessionTimerFor(obj.client.session_id, (err) => {});
    });
  }

  //----------

    // Given a session id and duration, add the given duration to any
  // existing cached duration and return the accumulated number
  _getStashedDurationFor(session, duration, cb) {
    var key, s;
    if (this.redis) {
      // use redis stash
      key = `duration-${session}`;
      this.redis.incrby(key, Math.round(duration), (err, res) => {
        return cb(err, res);
      });
      // set a TTL on our key, so that it doesn't stay indefinitely
      return this.redis.pexpire(key, 5 * 60 * 1000, (err) => {
        if (err) {
          return this.logger.error(`Failed to set Redis TTL for ${key}: ${err}`);
        }
      });
    } else {
      // use memory stash
      s = this._ensureMemorySession(session);
      s.duration += duration;
      return cb(null, s.duration);
    }
  }

  //----------
  _updateSessionTimerFor(session, cb) {
    var s, timeout_at;
    if (this._timeout_sec <= 0) {
      // timeouts are disabled
      return cb(null);
    }
    if (this.redis) {
      // this will set the score, or update it if the session is
      // already in the set
      timeout_at = (Number(new Date()) / 1000) + this._timeout_sec;
      return this.redis.zadd("session-timeouts", timeout_at, session, (err) => {
        return cb(err);
      });
    } else {
      s = this._ensureMemorySession(session);
      if (s.timeout) {
        clearTimeout(s.timeout);
      }
      s.timeout = setTimeout(() => {
        return this._triggerSession(session);
      }, this._timeout_sec * 1000);
      return cb(null);
    }
  }

  //----------
  _scrubSessionFor(session, cb) {
    var s;
    if (this.redis) {
      return this.redis.zrem("session-timeouts", session, (err) => {
        if (err) {
          return cb(err);
        }
        return this.redis.del(`duration-${session}`, (err) => {
          return cb(err);
        });
      });
    } else {
      s = this._ensureMemorySession(session);
      if (s.timeout) {
        clearTimeout(s.timeout);
      }
      delete this.sessions[session];
      return cb(null);
    }
  }

  //----------
  _ensureMemorySession(session) {
    var base;
    return (base = this.sessions)[session] || (base[session] = {
      duration: 0,
      last_seen_at: Number(new Date()),
      timeout: null
    });
  }

  //----------
  _triggerSession(session) {
    return this._scrubSessionFor(session, (err) => {
      if (err) {
        return this.logger.error(`Error cleaning session cache: ${err}`);
      }
      return this._finalizeSession(session, (err, obj) => {
        if (err) {
          return this.logger.error(`Error assembling session: ${err}`);
        }
        if (obj) {
          return this._storeSession(obj, (err) => {
            if (err) {
              return this.logger.error(`Error writing session: ${err}`);
            }
          });
        }
      });
    });
  }

  //----------
  _finalizeSession(id, cb) {
    var session;
    this.logger.debug(`Finalizing session for ${id}`);
    // This is a little ugly. We need to take several steps:
    // 1) Have we ever finalized this session id?
    // 2) Look up the session_start for the session_id
    // 3) Compute the session's sent kbytes, sent duration, and elapsed duration
    // 4) Write a session object
    session = {};
    // -- Get Started -- #
    return this._selectPreviousSession(id, (err, ts) => {
      if (err) {
        this.logger.error(err);
        return typeof cb === "function" ? cb(err) : void 0;
      }
      return this._selectSessionStart(id, (err, start) => {
        if (err) {
          this.logger.error(err);
          return cb(err);
        }
        if (!start) {
          this.logger.debug(`Attempt to finalize invalid session. No start event for ${id}.`);
          return cb(null, false);
        }
        return this._selectListenTotals(id, ts, (err, totals) => {
          if (err) {
            this.logger.error(err);
            return typeof cb === "function" ? cb(err) : void 0;
          }
          if (!totals) {
            // Session did not have any recorded listen events.  Toss it.
            return cb(null, false);
          }
          // -- build session -- #
          session = {
            session_id: id,
            output: start.output,
            stream: start.stream,
            time: totals.last_listen,
            start_time: ts || start.time,
            client: start.client,
            kbytes: totals.kbytes,
            duration: totals.duration,
            connected: (Number(totals.last_listen) - Number(ts || start.time)) / 1000
          };
          return cb(null, session);
        });
      });
    });
  }

};

//# sourceMappingURL=index.js.map
