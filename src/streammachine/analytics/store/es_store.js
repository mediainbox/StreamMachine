var AnalyticsEsStore, BatchedQueue, ESTemplates, EsIndexWriter, URL, _, elasticsearch, nconf, tz;

URL = require("url");

elasticsearch = require("@elastic/elasticsearch");

BatchedQueue = require("../../util/batched_queue");

EsIndexWriter = require("./index_writer");

ESTemplates = require("./es_templates");

tz = require('timezone');

nconf = require("nconf");

_ = require("lodash");

module.exports = AnalyticsEsStore = class AnalyticsEsStore {
  constructor(config, ctx) {
    var apiVersion, es_uri;
    this.config = config;
    this.ctx = ctx;
    this._uri = URL.parse(this.config.es_uri);
    this.logger = this.ctx.logger.child({
      component: 'analytics:store'
    });
    this._timeout_sec = Number(this.config.finalize_secs);
    es_uri = this.config.es_uri;
    this.idx_prefix = this.config.es_prefix;
    this.logger.debug(`Connecting to Elasticsearch at ${es_uri} with prefix of ${this.idx_prefix}`);
    apiVersion = '1.7';
    if (typeof this.config.es_api_version !== 'undefined') {
      apiVersion = this.config.es_api_version.toString();
    }
    this.es = new elasticsearch.Client({
      node: es_uri,
      apiVersion: apiVersion,
      requestTimeout: this.config.request_timeout || 30000
    });
    this.idx_batch = new BatchedQueue({
      batch: this.config.index_batch,
      latency: this.config.index_latency
    });
    this.idx_writer = new EsIndexWriter(this.es, this.logger.child({
      submodule: "idx_writer"
    }));
    this.idx_writer.on("error", (err) => {
      return this.logger.error(err);
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
        this.logger.debug("Hitting cb after loading templates");
        return typeof cb === "function" ? cb(null, this) : void 0;
      }
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
  _selectPreviousSession(sessionId, cb) {
    var body;
    // -- Have we ever finalized this session id? -- #
    body = {
      query: {
        bool: {
          must: [
            {
              match: {
                "session_id": sessionId
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
          return cb(new Error(`Error querying for old session ${sessionId}: ${err}`));
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
  _loadTemplates(cb) {
    var _loaded, errors, obj, results, t, tmplt;
    errors = [];
    this.logger.debug(`Loading ${Object.keys(ESTemplates).length} ElasticSearch templates`);
    _loaded = _.after(Object.keys(ESTemplates).length, () => {
      if (errors.length > 0) {
        this.logger.debug(`Failed to load one or more ElasticSearch templates: ${errors.join(" | ")}`);
        this.logger.info(errors);
        return cb(new Error(`Failed to load index templates: ${errors.join(" | ")}`));
      } else {
        this.logger.debug("ES templates loaded successfully.");
        return cb(null);
      }
    });
    results = [];
    for (t in ESTemplates) {
      obj = ESTemplates[t];
      this.logger.debug(`Loading ElasticSearch mapping for ${this.idx_prefix}-${t}`);
      //@logger.info "Loading Elasticsearch mappings for #{@idx_prefix}-#{t}"
      tmplt = _.extend({}, obj, {
        index_patterns: `${this.idx_prefix}-${t}-*`
      });
      //@logger.info tmplt
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

};
