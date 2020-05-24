export const DEFAULT_CONFIG = {
  meta_interval: 32768,
  max_buffer: 4194304, // 4 megabits (64 seconds of 64k audio)
  key: null,
  seconds: 60 * 60 * 4, // 4 hours
  burst: 30,
  source_password: null,
  host: null,
  fallback: null,
  acceptSourceMeta: false,
  log_minutes: true,
  monitored: false,
  metaTitle: "",
  metaUrl: "",
  format: "mp3",
  preroll: "",
  preroll_key: "",
  transcoder: "",
  root_route: false,
  group: null,
  bandwidth: 0,
  codec: null,
  ffmpeg_args: null,
  stream_key: null,
  impression_delay: 5000,
  log_interval: 30000,
  geolock: null
};
