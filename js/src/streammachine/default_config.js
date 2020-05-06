module.exports = {
  mode: "standalone",
  handoff_type: "external",
  http_port: 443,
  https_port: 80,
  port: 8000,
  source_port: 8001,
  log: {
    stdout: true,
    stackdriver: false
  },
  ua_skip: false,
  hls: {
    segment_duration: 10,
    limit_full_index: false
  },
  analytics: {
    finalize_secs: 300,
    index_batch: 1000,
    index_latency: 500
  },
  chunk_duration: 2,
  behind_proxy: false,
  debug_incoming_requests: false,
  cluster: 2,
  log_interval: 30000,
  admin: {
    require_auth: false
  },
  cors: {
    enabled: true
  }
};

//# sourceMappingURL=default_config.js.map
