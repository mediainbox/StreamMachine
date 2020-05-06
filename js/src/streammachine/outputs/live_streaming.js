var BaseOutput, LiveStreaming, PTS_TAG, _, s, tz, uuid;

_ = require("underscore");

tz = require("timezone");

uuid = require("node-uuid");

BaseOutput = require("./base");

PTS_TAG = Buffer.from((function() {
  var i, len, ref, results;
  ref = `49 44 33 04 00 00 00 00 00 3F 50 52 49 56 00 00 00 35 00 00 63 6F 6D
2E 61 70 70 6C 65 2E 73 74 72 65 61 6D 69 6E 67 2E 74 72 61 6E 73 70
6F 72 74 53 74 72 65 61 6D 54 69 6D 65 73 74 61 6D 70 00 00 00 00 00
00 00 00 00`.split(/\s+/);
  results = [];
  for (i = 0, len = ref.length; i < len; i++) {
    s = ref[i];
    results.push(Number(`0x${s}`));
  }
  return results;
})());

module.exports = LiveStreaming = (function() {
  class LiveStreaming extends BaseOutput {
    constructor(stream, opts) {
      super("live_streaming");
      this.stream = stream;
      this.opts = opts;
      this.stream.listen(this, {
        live_segment: this.opts.req.params.seg,
        pumpOnly: true
      }, (err, playHead, info) => {
        var headers, tag;
        if (err) {
          this.opts.res.status(404).end("Segment not found.");
          return false;
        }
        // write our PTS tag
        tag = null;
        if (info.pts) {
          tag = Buffer.from(PTS_TAG);
          // node 0.10 doesn't know how to write ints over 32-bit, so
          // we do some gymnastics to get around it
          if (info.pts > Math.pow(2, 32) - 1) {
            tag[0x44] = 0x01;
            tag.writeUInt32BE(info.pts - (Math.pow(2, 32) - 1), 0x45);
          } else {
            tag.writeUInt32BE(info.pts, 0x45);
          }
        }
        headers = {
          "Content-Type": this.stream.opts.format === "mp3" ? "audio/mpeg" : this.stream.opts.format === "aac" ? "audio/aac" : "unknown",
          "Connection": "close",
          "Content-Length": info.length + (tag != null ? tag.length : void 0) || 0
        };
        // write out our headers
        this.opts.res.writeHead(200, headers);
        if (tag) {
          this.opts.res.write(tag);
        }
        // send our pump buffer to the client
        playHead.pipe(this.opts.res);
        this.opts.res.on("finish", () => {
          return playHead.disconnect();
        });
        this.opts.res.on("close", () => {
          return playHead.disconnect();
        });
        return this.opts.res.on("end", () => {
          return playHead.disconnect();
        });
      });
    }

    //----------
    prepForHandoff(cb) {
      // we don't do handoffs, so send skip = true
      return cb(true);
    }

  };

  //----------
  LiveStreaming.Index = class Index extends BaseOutput {
    constructor(stream, opts) {
      var outFunc, session_info;
      super("live_streaming");
      this.stream = stream;
      this.opts = opts;
      session_info = this.client.session_id && this.client.pass_session ? `?session_id=${this.client.session_id}` : void 0;
      // HACK: This is needed to get ua information on segments until we
      // can fix client ua for AppleCoreMedia
      if (this.opts.req.query.ua) {
        session_info = session_info ? `${session_info}&ua=${this.opts.req.query.ua}` : `?ua=${this.opts.req.query.ua}`;
      }
      if (!this.stream.hls) {
        this.opts.res.status(500).end("No data.");
        return;
      }
      // which index should we give them?
      outFunc = (err, writer) => {
        if (writer) {
          this.opts.res.writeHead(200, {
            "Content-type": "application/vnd.apple.mpegurl",
            "Content-length": writer.length()
          });
          return writer.pipe(this.opts.res);
        } else {
          return this.opts.res.status(500).end("No data.");
        }
      };
      if (this.opts.req.hls_limit) {
        this.stream.hls.short_index(session_info, outFunc);
      } else {
        this.stream.hls.index(session_info, outFunc);
      }
    }

  };

  //----------
  LiveStreaming.GroupIndex = class GroupIndex extends BaseOutput {
    constructor(group, opts) {
      super("live_streaming");
      this.group = group;
      this.opts = opts;
      this.opts.res.writeHead(200, {
        "Content-type": "application/vnd.apple.mpegurl"
      });
      // who do we ask for the session id?
      this.group.startSession(this.client, (err) => {
        var key, ref, session_bits, url;
        this.opts.res.write(`#EXTM3U
`);
        ref = this.group.streams;
        for (key in ref) {
          s = ref[key];
          url = `/${s.key}.m3u8`;
          session_bits = [];
          if (this.client.pass_session) {
            session_bits.push(`session_id=${this.client.session_id}`);
          }
          if (this.opts.req.query.ua) {
            session_bits.push(`ua=${this.opts.req.query.ua}`);
          }
          if (session_bits.length > 0) {
            url = `${url}?${session_bits.join("&")}`;
          }
          this.opts.res.write(`#EXT-X-STREAM-INF:BANDWIDTH=${s.opts.bandwidth},CODECS="${s.opts.codec}"
${url}\n`);
        }
        return this.opts.res.end();
      });
    }

  };

  return LiveStreaming;

}).call(this);

//# sourceMappingURL=live_streaming.js.map
