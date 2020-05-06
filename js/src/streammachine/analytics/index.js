var Analytics, BatchedQueue, ESTemplates, IdxWriter, URL, _, debug, elasticsearch, nconf, tz, winston;

_ = require("underscore");

URL = require("url");

winston = require("winston");

tz = require("timezone");

nconf = require("nconf");

elasticsearch = require("@elastic/elasticsearch");

BatchedQueue = require("../util/batched_queue");

IdxWriter = require("./idx_writer");

ESTemplates = require("./es_templates");

debug = require("debug")("sm:analytics");

// This module is responsible for:

// * Listen for session_start and listen interactions
// * Watch for sessions that are no longer active.  Finalize them, attaching
//   stats and duration, and throwing out sessions that did not meet minimum
//   requirements
// * Answer questions about current number of listeners at any given time
// * Produce old-style w3c output for listener stats
module.exports = Analytics = (function() {
  class Analytics {
    constructor(opts, cb) {
      var apiVersion, es_uri;
      this.opts = opts;
      this._uri = URL.parse(this.opts.config.es_uri);
      this.log = this.opts.log;
      this._timeout_sec = Number(this.opts.config.finalize_secs);
      if (this.opts.redis) {
        this.redis = this.opts.redis.client;
      }
      es_uri = this.opts.config.es_uri;
      this.idx_prefix = this.opts.config.es_prefix;
      this.log.debug(`Connecting to Elasticsearch at ${es_uri} with prefix of ${this.idx_prefix}`);
      debug(`Connecting to ES at ${es_uri}, prefix ${this.idx_prefix}`);
      apiVersion = '1.7';
      if (typeof this.opts.config.es_api_version !== 'undefined') {
        apiVersion = this.opts.config.es_api_version.toString();
      }
      this.es = new elasticsearch.Client({
        node: es_uri,
        apiVersion: apiVersion,
        requestTimeout: this.opts.config.request_timeout || 30000
      });
      this.idx_batch = new BatchedQueue({
        batch: this.opts.config.index_batch,
        latency: this.opts.config.index_latency
      });
      this.idx_writer = new IdxWriter(this.es, this.log.child({
        submodule: "idx_writer"
      }));
      this.idx_writer.on("error", (err) => {
        return this.log.error(err);
      });
      this.idx_batch.pipe(this.idx_writer);
      // track open sessions
      this.sessions = {};
      this.local = tz(require("timezone/zones"))(nconf.get("timezone") || "UTC");
      // -- Load our Templates -- #
      this._loadTemplates((err) => {
        if (err) {
          console.error(err);
          return typeof cb === "function" ? cb(err) : void 0;
        } else {
          // do something...
          debug("Hitting cb after loading templates");
          return typeof cb === "function" ? cb(null, this) : void 0;
        }
      });
      // -- are there any sessions that should be finalized? -- #

      // when was our last finalized session?
      //last_session = @influx.query "SELECT max(time) from sessions", (err,res) =>
      //    console.log "last session is ", err, res

      // what sessions have we seen since then?

      // -- Redis Session Sweep -- #
      if (this.redis) {
        this.log.info("Analytics setting up Redis session sweeper");
        setInterval(() => {
          // look for sessions that should be written (score less than now)
          return this.redis.zrangebyscore("session-timeouts", 0, Math.floor(Number(new Date()) / 1000), (err, sessions) => {
            var _sFunc;
            if (err) {
              return this.log.error(`Error fetching sessions to finalize: ${err}`);
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
    _loadTemplates(cb) {
      var _loaded, errors, obj, results, t, tmplt;
      errors = [];
      debug(`Loading ${Object.keys(ESTemplates).length} ES templates`);
      _loaded = _.after(Object.keys(ESTemplates).length, () => {
        if (errors.length > 0) {
          debug(`Failed to load one or more ES templates: ${errors.join(" | ")}`);
          this.log.info(errors);
          return cb(new Error(`Failed to load index templates: ${errors.join(" | ")}`));
        } else {
          debug("ES templates loaded successfully.");
          return cb(null);
        }
      });
      results = [];
      for (t in ESTemplates) {
        obj = ESTemplates[t];
        debug(`Loading ES mapping for ${this.idx_prefix}-${t}`);
        this.log.info(`Loading Elasticsearch mappings for ${this.idx_prefix}-${t}`);
        tmplt = _.extend({}, obj, {
          index_patterns: `${this.idx_prefix}-${t}-*`
        });
        this.log.info(tmplt);
        results.push(this.es.indices.putTemplate({
          name: `${this.idx_prefix}-${t}-template`,
          body: tmplt
        }, (err) => {
          if (err) {
            errors.push(err);
          }
          return _loaded();
        }));
      }
      return results;
    }

    //----------

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
            return this.log.error(`Failed to set Redis TTL for ${key}: ${err}`);
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
          return this.log.error(`Error cleaning session cache: ${err}`);
        }
        return this._finalizeSession(session, (err, obj) => {
          if (err) {
            return this.log.error(`Error assembling session: ${err}`);
          }
          if (obj) {
            return this._storeSession(obj, (err) => {
              if (err) {
                return this.log.error(`Error writing session: ${err}`);
              }
            });
          }
        });
      });
    }

    //----------
    _finalizeSession(id, cb) {
      var session;
      this.log.silly(`Finalizing session for ${id}`);
      // This is a little ugly. We need to take several steps:
      // 1) Have we ever finalized this session id?
      // 2) Look up the session_start for the session_id
      // 3) Compute the session's sent kbytes, sent duration, and elapsed duration
      // 4) Write a session object
      session = {};
      // -- Get Started -- #
      return this._selectPreviousSession(id, (err, ts) => {
        if (err) {
          this.log.error(err);
          return typeof cb === "function" ? cb(err) : void 0;
        }
        return this._selectSessionStart(id, (err, start) => {
          if (err) {
            this.log.error(err);
            return cb(err);
          }
          if (!start) {
            this.log.debug(`Attempt to finalize invalid session. No start event for ${id}.`);
            return cb(null, false);
          }
          return this._selectListenTotals(id, ts, (err, totals) => {
            if (err) {
              this.log.error(err);
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

    //----------
    _storeSession(session, cb) {
      var index_date;
      // write one index per day of data
      index_date = tz(session.time, "%F");
      return this.es.index({
        index: `${this.idx_prefix}-sessions-${index_date}`,
        type: '_doc',
        body: session
      }, (err) => {
        if (err) {
          return cb(new Error(`Error creating index ${this.idx_prefix}-sessions-${index_date} ${err}`));
        }
      });
    }

    //----------
    _selectSessionStart(id, cb) {
      var body;
      // -- Look up user information from session_start -- #
      body = {
        query: {
          bool: {
            must: [
              {
                match: {
                  "session_id": id
                }
              },
              {
                match: {
                  "type": "start"
                }
              }
            ]
          }
        },
        sort: {
          time: {
            order: "desc"
          }
        },
        size: 1
      };
      // session start is allowed to be anywhere in the last 24 hours
      return this._indicesForTimeRange("listens", new Date(), "-72 hours", (err, indices) => {
        return this.es.search({
          body: body,
          index: indices,
          ignoreUnavailable: true
        }, (err, res) => {
          if (err) {
            return cb(new Error(`Error querying session start for ${id}: ${err}`));
          }
          if (res.body.hits && res.body.hits.total.value > 0) {
            return cb(null, _.extend({}, res.body.hits.hits[0]._source, {
              time: new Date(res.body.hits.hits[0]._source.time)
            }));
          }
        });
      });
    }

    //----------
    _selectPreviousSession(id, cb) {
      var body;
      // -- Have we ever finalized this session id? -- #
      body = {
        query: {
          bool: {
            must: [
              {
                match: {
                  "session_id": id
                }
              },
              {
                match: {
                  "type": "session"
                }
              }
            ]
          }
        },
        sort: {
          time: {
            order: "desc"
          }
        },
        size: 1
      };
      return this._indicesForTimeRange("sessions", new Date(), "-72 hours", (err, indices) => {
        return this.es.search({
          body: body,
          index: indices,
          ignoreUnavailable: true
        }, (err, res) => {
          if (err) {
            return cb(new Error(`Error querying for old session ${id}: ${err}`));
          }
          if (!res.body.hits || res.body.hits.total.value === 0) {
            return cb(null, null);
          } else {
            return cb(null, new Date(res.body.hits.hits[0]._source.time));
          }
        });
      });
    }

    //----------
    _selectListenTotals(id, ts, cb) {
      var body, filter;
      // -- Query total duration and kbytes sent -- #
      filter = ts ? {
        "and": {
          filters: [
            {
              range: {
                time: {
                  gt: ts
                }
              }
            },
            {
              term: {
                session_id: id
              }
            },
            {
              term: {
                type: "listen"
              }
            }
          ]
        }
      } : {
        term: {
          session_id: id
        }
      };
      body = {
        query: {
          constant_score: {
            filter: filter
          }
        },
        aggs: {
          duration: {
            sum: {
              field: "duration"
            }
          },
          kbytes: {
            sum: {
              field: "kbytes"
            }
          },
          last_listen: {
            max: {
              field: "time"
            }
          }
        }
      };
      return this._indicesForTimeRange("listens", new Date(), ts || "-72 hours", (err, indices) => {
        return this.es.search({
          index: indices,
          body: body,
          ignoreUnavailable: true
        }, (err, res) => {
          if (err) {
            return cb(new Error(`Error querying listens to finalize session ${id}: ${err}`));
          }
          if (res.body.hits.total.value > 0) {
            return cb(null, {
              requests: res.body.hits.total.value,
              duration: res.body.aggregations.duration.value,
              kbytes: res.body.aggregations.kbytes.value,
              last_listen: new Date(res.body.aggregations.last_listen.value)
            });
          } else {
            return cb(null, null);
          }
        });
      });
    }

    //----------
    _indicesForTimeRange(idx, start, end, cb) {
      var indices, s;
      if (_.isFunction(end)) {
        cb = end;
        end = null;
      }
      start = this.local(start);
      if (_.isString(end) && end[0] === "-") {
        end = this.local(start, end);
      }
      indices = [];
      if (end) {
        end = this.local(end);
        s = start;
        while (true) {
          s = this.local(s, "-1 day");
          if (s < end) {
            break;
          }
          indices.push(`${this.idx_prefix}-${idx}-${this.local(s, "%F")}`);
        }
      }
      indices.unshift(`${this.idx_prefix}-${idx}-${this.local(start, "%F")}`);
      return cb(null, _.uniq(indices));
    }

    //----------
    countListeners(cb) {
      var body;
      // -- Query recent listeners -- #
      body = {
        query: {
          constant_score: {
            filter: {
              range: {
                time: {
                  gt: "now-15m"
                }
              }
            }
          }
        },
        size: 0,
        aggs: {
          listeners_by_minute: {
            date_histogram: {
              field: "time",
              fixed_interval: "1m"
            },
            aggs: {
              duration: {
                sum: {
                  field: "duration"
                }
              },
              sessions: {
                cardinality: {
                  field: "session_id"
                }
              },
              streams: {
                terms: {
                  field: "stream",
                  size: 50
                }
              }
            }
          }
        }
      };
      return this._indicesForTimeRange("listens", new Date(), "-15 minutes", (err, indices) => {
        return this.es.search({
          index: indices,
          body: body,
          ignoreUnavailable: true
        }, (err, res) => {
          var i, j, len, len1, obj, ref, ref1, sobj, streams, times;
          if (err) {
            return cb(new Error(`Failed to query listeners: ${err}`));
          }
          times = [];
          if (!res.body.aggregations) {
            cb(null, times);
            return;
          }
          ref = res.body.aggregations.listeners_by_minute.buckets;
          for (i = 0, len = ref.length; i < len; i++) {
            obj = ref[i];
            streams = {};
            ref1 = obj.streams.buckets;
            for (j = 0, len1 = ref1.length; j < len1; j++) {
              sobj = ref1[j];
              streams[sobj.key] = sobj.doc_count;
            }
            times.unshift({
              time: this.local(new Date(obj.key), "%F %T%^z"),
              requests: obj.doc_count,
              avg_listeners: Math.round(obj.duration.value / 60),
              sessions: obj.sessions.value,
              requests_by_stream: streams
            });
          }
          return cb(null, times);
        });
      });
    }

  };

  //----------
  Analytics.LogTransport = (function() {
    class LogTransport extends winston.Transport {
      constructor(a) {
        super({
          level: "interaction"
        });
        this.a = a;
      }

      log(level, msg, meta, cb) {
        if (level === "interaction") {
          this.a._log(meta);
          return typeof cb === "function" ? cb() : void 0;
        }
      }

    };

    LogTransport.prototype.name = "analytics";

    return LogTransport;

  }).call(this);

  return Analytics;

}).call(this);

//----------

//# sourceMappingURL=index.js.map
