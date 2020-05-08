var AAC, CHANNEL_COUNTS, ID3V2_HEADER_LENGTH, MPEG_HEADER, MPEG_HEADER_LENGTH, PROFILES, REST_OF_ID3V2_HEADER, SAMPLE_FREQUENCIES, assert, strtok;

strtok = require('strtok2');

assert = require("assert");

PROFILES = ["Null", "AAC Main", "AAC LC", "AAC SSR", "AAC LTP", "SBR", "AAC Scalable", "TwinVQ"];

SAMPLE_FREQUENCIES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

CHANNEL_COUNTS = [0, 1, 2, 3, 4, 5, 6, 8];

MPEG_HEADER_LENGTH = 4;

ID3V2_HEADER_LENGTH = 10;

MPEG_HEADER = new strtok.BufferType(MPEG_HEADER_LENGTH);

REST_OF_ID3V2_HEADER = new strtok.BufferType(ID3V2_HEADER_LENGTH - MPEG_HEADER_LENGTH);

module.exports = AAC = (function() {
  var FIRST_BYTE;

  class AAC extends require("stream").Writable {
    constructor() {
      var _emitAndMaybeEnd;
      super();
      // create an internal stream to pass to strtok
      this.istream = new ((require("events").EventEmitter))();
      this._flushing = false;
      // set up status
      this.frameSize = -1;
      this.beginning = true;
      this.gotFF = false;
      this.byteTwo = null;
      this.isCRC = false;
      this.gotID3 = 0;
      this.frameHeader = null;
      this.frameHeaderBuf = null;
      this.id3v2 = null;
      this._parsingId3v2 = false;
      this._finishingId3v2 = false;
      this._id3v2_1 = null;
      this._id3v2_2 = null;
      this.once("finish", () => {
        return this._flushing = setTimeout(() => {
          return this.emit("end");
        }, 500);
      });
      _emitAndMaybeEnd = (...args) => {
        this.emit(...args);
        if (this._flushing) {
          clearTimeout(this._flushing);
          return this._flushing = setTimeout(() => {
            return this.emit("end");
          }, 500);
        }
      };
      strtok.parse(this.istream, (v, cb) => {
        var b, buf, e, frame, h, tag;
        // -- initial request -- #
        if (v === void 0) {
          // we need to examine each byte until we get a FF
          return FIRST_BYTE;
        }
        // -- ID3v2 tag -- #
        if (this._parsingId3v2) {
          // we'll already have @id3v2 started with versionMajor and
          // our first byte in @_id3v2_1
          this.id3v2.versionMinor = v[0];
          this.id3v2.flags = v[1];
          // calculate the length
          this.id3v2.length = (v[5] & 0x7f) | ((v[4] & 0x7f) << 7) | ((v[3] & 0x7f) << 14) | ((v[2] & 0x7f) << 21);
          this._parsingId3v2 = false;
          this._finishingId3v2 = true;
          this._id3v2_2 = v;
          return new strtok.BufferType(this.id3v2.length);
        }
        if (this._finishingId3v2) {
          // step 3 in the ID3v2 parse...
          b = Buffer.concat([this._id3v2_1, this._id3v2_2, v]);
          _emitAndMaybeEnd('id3v2', b);
          this._finishingId3v2 = false;
          return FIRST_BYTE;
        }
        // -- frame header -- #
        if (this.frameSize === -1 && this.frameHeader) {
          // we're on-schedule now... we've had a valid frame.
          // buffer should be seven or nine bytes
          tag = v.toString('ascii', 0, 3);
          if (tag === 'ID3') {
            // parse ID3v2 tag
            _emitAndMaybeEnd("debug", "got an ID3");
            this._parsingId3v2 = true;
            this.id3v2 = {
              versionMajor: v[3]
            };
            this._id3v2_1 = v;
            return REST_OF_ID3V2_HEADER;
          } else {
            try {
              h = this.parseFrame(v);
            } catch (error) {
              e = error;
              // uh oh...  bad news
              console.log("invalid header... ", v, this.frameHeader);
              this.frameHeader = null;
              return FIRST_BYTE;
            }
            this.frameHeader = h;
            this.frameHeaderBuf = v;
            _emitAndMaybeEnd("header", h);
            this.frameSize = this.frameHeader.frame_length;
            if (this.frameSize === 1) {
              // problem...  just start over
              console.log("Invalid frame header: ", h);
              return FIRST_BYTE;
            } else {
              return new strtok.BufferType(this.frameSize - v.length);
            }
          }
        }
        // -- first header -- #
        if (this.gotFF && this.byteTwo) {
          buf = Buffer.alloc(2 + v.length);
          buf[0] = 0xFF;
          buf[1] = this.byteTwo;
          v.copy(buf, 2);
          try {
            h = this.parseFrame(buf);
          } catch (error) {
            e = error;
            // invalid header...  chuck everything and try again
            console.log("chucking invalid try at header: ", buf);
            this.gotFF = false;
            this.byteTwo = null;
            return FIRST_BYTE;
          }
          // valid header...  we're on schedule now
          this.gotFF = false;
          this.byteTwo = null;
          this.beginning = false;
          this.frameHeader = h;
          this.frameHeaderBuf = buf;
          _emitAndMaybeEnd("header", h);
          this.frameSize = this.frameHeader.frame_length;
          this.isCRC = h.crc;
          if (this.frameSize === 1) {
            // problem...  just start over
            console.log("Invalid frame header: ", h);
            return FIRST_BYTE;
          } else {
            //console.log "On-tracking with frame of: ", @frameSize - buf.length
            return new strtok.BufferType(this.frameSize - buf.length);
          }
        }
        if (this.gotFF) {
          if (v[0] >> 4 === 0xF) {
            this.byteTwo = v[0];
            // make sure the layer bits are zero...  still need to make
            // sure we're on a valid header
            if ((v[0] & 6) === 0) {
              // good... both zeros...

              // we need to figure out whether we're looking for CRC.  If
              // not, we need five more bytes for the header.  If so, we
              // need seven more. 1 == No CRC, 0 == CRC
              return new strtok.BufferType((v[0] & 1) === 1 ? 5 : 7);
            } else {
              this.gotFF = false;
            }
          } else {
            this.gotFF = false;
          }
        }
        if (this.frameSize === -1 && !this.gotFF) {
          if (v[0] === 0xFF) {
            // possible start of frame header. need next byte to know more
            this.gotFF = true;
            return FIRST_BYTE;
          } else if (v[0] === 0x49) {
            // could be the I in ID3
            this.gotID3 = 1;
            return FIRST_BYTE;
          } else if (this.gotID3 === 1 && v[0] === 0x44) {
            this.gotID3 = 2;
            return FIRST_BYTE;
          } else if (this.gotID3 === 2 && v[0] === 0x33) {
            this.gotID3 = 3;
            return FIRST_BYTE;
          } else if (this.gotID3 === 3) {
            this._id3v2_1 = Buffer.from([0x49, 0x44, 0x33, v[0]]);
            this.id3v2 = {
              versionMajor: v[0]
            };
            this._parsingId3v2 = true;
            this.gotID3 = 0;
            return REST_OF_ID3V2_HEADER;
          } else {
            // keep looking
            return FIRST_BYTE;
          }
        }
        // -- data frame -- #
        if (this.frameHeaderBuf) {
          frame = Buffer.alloc(this.frameHeaderBuf.length + v.length);
          this.frameHeaderBuf.copy(frame, 0);
          v.copy(frame, this.frameHeaderBuf.length);
          _emitAndMaybeEnd("frame", frame, this.frameHeader);
        }
        this.frameSize = -1;
        // what's next depends on whether we've been seeing CRC
        return new strtok.BufferType(this.isCRC ? 9 : 7);
      });
    }

    //----------
    _write(chunk, encoding, callback) {
      this.istream.emit("data", chunk);
      return typeof callback === "function" ? callback() : void 0;
    }

    //----------
    parseFrame(b) {
      var header;
      assert.ok(Buffer.isBuffer(b));
      assert.ok(b.length >= 7);
      // -- first twelve bits must be FFF -- #
      assert.ok(b[0] === 0xFF && (b[1] >> 4) === 0xF, "Buffer does not start with FFF");
      // -- set up our object -- #
      header = {
        crc: !(b[1] & 0x1),
        mpeg_type: (b[1] & 0x8) ? "MPEG2" : "MPEG4",
        profile: (b[2] >> 6) + 1,
        sample_freq: SAMPLE_FREQUENCIES[b[2] >> 2 & 0xF],
        channel_config: (b[2] & 1) << 2 | b[3] >> 6,
        frame_length: (b[3] & 0x3) << 11 | b[4] << 3 | b[5] >> 5,
        buffer_fullness: (b[5] & 0x1F) << 6 | b[6] >> 2,
        number_of_frames: (b[6] & 0x3) + 1,
        profile_name: "",
        channels: 0,
        frames_per_sec: 0,
        duration: 0,
        stream_key: ""
      };
      // -- fill in remaining values -- #
      header.profile_name = PROFILES[header.profile];
      header.channels = CHANNEL_COUNTS[header.channel_config];
      header.frames_per_sec = header.sample_freq / 1024;
      header.duration = (1 / header.frames_per_sec) * 1000;
      header.stream_key = ['aac', header.sample_freq, header.profile, header.channels].join("-");
      return header;
    }

  };

  FIRST_BYTE = new strtok.BufferType(1);

  return AAC;

}).call(this);
