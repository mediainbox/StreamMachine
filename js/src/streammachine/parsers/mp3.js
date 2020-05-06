var MP3, assert, strtok;

strtok = require('strtok2');

assert = require("assert");

module.exports = MP3 = (function() {
  var BITRATE_MAP, BITRATE_MPEG1_LAYER1, BITRATE_MPEG1_LAYER2, BITRATE_MPEG1_LAYER3, BITRATE_MPEG2_LAYER1, BITRATE_MPEG2_LAYER2A3, FIRST_BYTE, ID3V1_LENGTH, ID3V2_HEADER_LENGTH, LAYER1_ID, LAYER2_ID, LAYER3_ID, LAYER_NAME, MODE_DUAL, MODE_JOINT, MODE_MONO, MODE_NAME, MODE_STEREO, MPEG1_ID, MPEG25_ID, MPEG2_ID, MPEG_HEADER, MPEG_HEADER_LENGTH, MPEG_NAME, REST_OF_ID3V1, REST_OF_ID3V2_HEADER, SAMPLING_RATES;

  class MP3 extends require("stream").Writable {
    constructor() {
      var _emitAndMaybeEnd;
      super();
      // create an internal stream to pass to strtok
      this.istream = new ((require("events").EventEmitter))();
      this.outbuf = [];
      this._flushing = false;
      // set up status
      this.frameSize = -1;
      this.beginning = true;
      this.gotFF = false;
      this.gotID3 = 0;
      this.byteTwo = null;
      this.frameHeader = null;
      this.frameHeaderBuf = null;
      this.id3v2 = null;
      this._parsingId3v1 = false;
      this._parsingId3v2 = false;
      this._finishingId3v2 = false;
      this._id3v2_1 = null;
      this._id3v2_2 = null;
      this._id3v1_1 = null;
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
        var b, buf, e, frame, h, id3, tag;
        // -- initial request -- #
        if (v === void 0) {
          // we need to examine each byte until we get a FF or ID3
          return FIRST_BYTE;
        }
        // -- ID3v1 tag -- #
        if (this._parsingId3v1) {
          // our first byte is in @_id3v1_1
          id3 = this.parseId3V1(Buffer.concat([this._id3v1_1, v]));
          _emitAndMaybeEnd("id3v1", id3);
          this._id3v1_1 = null;
          this._parsingId3v1 = false;
          return MPEG_HEADER;
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
          // buffer should be four bytes
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
          } else if (tag === 'TAG') {
            // parse ID3v1 tag
            _emitAndMaybeEnd("debug", "got a TAG");
            this._id3v1_1 = v;
            this._parsingId3v1 = true;
            // grab 125 bytes
            return REST_OF_ID3V1;
          } else {
            try {
              h = this.parseFrame(v);
            } catch (error) {
              e = error;
              // uh oh...  bad news
              _emitAndMaybeEnd("debug", "invalid header... ", v, tag, this.frameHeader);
              this.frameHeader = null;
              return FIRST_BYTE;
            }
            this.frameHeader = h;
            this.frameHeaderBuf = v;
            _emitAndMaybeEnd("header", v, h);
            this.frameSize = this.frameHeader.frameSize;
            if (this.frameSize === 1) {
              // problem...  just start over
              _emitAndMaybeEnd("debug", "Invalid frame header: ", h);
              return FIRST_BYTE;
            } else {
              return new strtok.BufferType(this.frameSize - MPEG_HEADER_LENGTH);
            }
          }
        }
        // -- first header -- #
        if (this.gotFF && this.byteTwo) {
          buf = Buffer.alloc(4);
          buf[0] = 0xFF;
          buf[1] = this.byteTwo;
          buf[2] = v[0];
          buf[3] = v[1];
          try {
            h = this.parseFrame(buf);
          } catch (error) {
            e = error;
            // invalid header...  chuck everything and try again
            _emitAndMaybeEnd("debug", "chucking invalid try at header: ", buf);
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
          this.frameSize = this.frameHeader.frameSize;
          if (this.frameSize === 1) {
            // problem...  just start over
            _emitAndMaybeEnd("debug", "Invalid frame header: ", h);
            return FIRST_BYTE;
          } else {
            _emitAndMaybeEnd("debug", "On-tracking with frame of: ", this.frameSize - MPEG_HEADER_LENGTH);
            return new strtok.BufferType(this.frameSize - MPEG_HEADER_LENGTH);
          }
        }
        if (this.gotFF) {
          if (v[0] >> 4 >= 0xE) {
            this.byteTwo = v[0];
            // need two more bytes
            return new strtok.BufferType(2);
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
        return MPEG_HEADER;
      });
    }

    //----------
    _write(chunk, encoding, cb) {
      if (this._flushing) {
        throw new Error("MP3 write while flushing.");
      }
      this.istream.emit("data", chunk);
      return typeof cb === "function" ? cb() : void 0;
    }

    //----------
    parseId3V1(id3v1) {
      var _stripNull, id3;
      id3 = {};
      _stripNull = function(buf) {
        var idx;
        idx = buf.toJSON().indexOf(0);
        return buf.toString("ascii", 0, idx === -1 ? buf.length : idx);
      };
      // TAG: 3 bytes
      // title: 30 bytes
      id3.title = _stripNull(id3v1.slice(3, 33));
      // artist: 30 bytes
      id3.artist = _stripNull(id3v1.slice(33, 63));
      // album: 30 bytes
      id3.album = _stripNull(id3v1.slice(63, 93));
      // year: 4 bytes
      id3.year = _stripNull(id3v1.slice(93, 97));
      // comment: 28 - 30 bytes
      if (id3v1[125] === 0) {
        id3.comment = _stripNull(id3v1.slice(97, 125));
        id3.track = id3v1.readUInt8(126);
      } else {
        id3.track = null;
        id3.comment = _stripNull(id3v1.slice(97, 127));
      }
      // genre: 1 byte
      id3.genre = id3v1.readUInt8(127);
      return id3;
    }

    //----------
    parseFrame(b) {
      var header32, r, ref, ref1;
      assert.ok(Buffer.isBuffer(b));
      // -- first twelve bits must be FF[EF] -- #
      assert.ok(b[0] === 0xFF && (b[1] >> 4) >= 0xE, "Buffer does not start with FF[EF]");
      header32 = b.readUInt32BE(0);
      // -- mpeg id -- #
      r = {
        mpegID: (header32 >> 19) & 3,
        layerID: (header32 >> 17) & 3,
        crc16used: (header32 & 0x00010000) === 0,
        bitrateIndex: (header32 >> 12) & 0xF,
        samplingRateIndex: (header32 >> 10) & 3,
        padding: (header32 & 0x00000200) !== 0,
        privateBitSet: (header32 & 0x00000100) !== 0,
        mode: (header32 >> 6) & 3,
        modeExtension: (header32 >> 4) & 3,
        copyrighted: (header32 & 0x00000008) !== 0,
        original: (header32 & 0x00000004) === 0,
        emphasis: header32 & 3,
        // placeholders for mem allocation
        channels: 0,
        bitrateKBPS: 0,
        mpegName: "",
        layerName: "",
        modeName: "",
        samplingRateHz: 0,
        samplesPerFrame: 0,
        bytesPerSlot: 0,
        frameSizeRaw: 0,
        frameSize: 0,
        frames_per_sec: 0,
        stream_key: ""
      };
      // now fill in the derived values...
      r.channels = r.mode === MODE_MONO ? 1 : 2;
      r.bitrateKBPS = BITRATE_MAP[r.mpegID][r.layerID][r.bitrateIndex];
      r.mpegName = MPEG_NAME[r.mpegID];
      r.layerName = LAYER_NAME[r.layerID];
      r.modeName = MODE_NAME[r.mode];
      r.samplingRateHz = SAMPLING_RATES[r.samplingRateIndex];
      if (r.mpegID === MPEG2_ID) {
        r.samplingRateHz >>= 1; // 16,22,48 kHz
      } else if (r.mpegID === MPEG25_ID) {
        r.samplingRateHz >>= 2; // 8,11,24 kHz
      }
      if (r.layerID === LAYER1_ID) {
        // layer 1: always 384 samples/frame and 4byte-slots
        r.samplesPerFrame = 384;
        r.bytesPerSlot = 4;
        r.frameSizeRaw = (12 * (r.bitrateKBPS * 1000) / (r.samplingRateHz * 10) + ((ref = r.padding) != null ? ref : {
          1: 0
        })) * 4;
      } else {
        // layer 2: always 1152 samples/frame
        // layer 3: MPEG1: 1152 samples/frame, MPEG2/2.5: 576 samples/frame
        r.samplesPerFrame = (r.mpegID === MPEG1_ID) || (r.layerID === LAYER2_ID) ? 1152 : 576;
        r.bytesPerSlot = 1;
        r.frameSizeRaw = (r.samplesPerFrame / 8) * (r.bitrateKBPS * 1000) / r.samplingRateHz + (r.padding ? 1 : 0);
      }
      // Make the frameSize be the proper floor'd byte length
      r.frameSize = ~~r.frameSizeRaw;
      if (!r.frameSize) {
        throw new Error('bad size: ' + r.frameSize);
      }
      // -- compute StreamMachine-specific header bits -- #
      r.frames_per_sec = r.samplingRateHz / r.samplesPerFrame;
      r.duration = (1 / r.frames_per_sec) * 1000;
      r.stream_key = ['mp3', r.samplingRateHz, r.bitrateKBPS, ((ref1 = r.modeName) === "Stereo" || ref1 === "J-Stereo" ? "s" : "m")].join("-");
      return r;
    }

  };

  ID3V1_LENGTH = 128;

  ID3V2_HEADER_LENGTH = 10;

  MPEG_HEADER_LENGTH = 4;

  FIRST_BYTE = new strtok.BufferType(1);

  // Mp3 parsing logic borrowed from node-lame: https://github.com/TooTallNate/node-lame
  MPEG_HEADER = new strtok.BufferType(MPEG_HEADER_LENGTH);

  REST_OF_ID3V2_HEADER = new strtok.BufferType(ID3V2_HEADER_LENGTH - MPEG_HEADER_LENGTH);

  REST_OF_ID3V1 = new strtok.BufferType(ID3V1_LENGTH - MPEG_HEADER_LENGTH);

  LAYER1_ID = 3;

  LAYER2_ID = 2;

  LAYER3_ID = 1;

  MPEG1_ID = 3;

  MPEG2_ID = 2;

  MPEG25_ID = 0;

  MODE_MONO = 3;

  MODE_DUAL = 2;

  MODE_JOINT = 1;

  MODE_STEREO = 0;

  MPEG_NAME = ["MPEG2.5", null, "MPEG2", "MPEG1"];

  LAYER_NAME = [null, "Layer3", "Layer2", "Layer1"];

  MODE_NAME = ["Stereo", "J-Stereo", "Dual", "Mono"];

  SAMPLING_RATES = [44100, 48000, 32000, 0];

  BITRATE_MPEG1_LAYER1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];

  BITRATE_MPEG1_LAYER2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];

  BITRATE_MPEG1_LAYER3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

  BITRATE_MPEG2_LAYER1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];

  BITRATE_MPEG2_LAYER2A3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

  BITRATE_MAP = [
    [
      null,
      BITRATE_MPEG2_LAYER2A3,
      BITRATE_MPEG2_LAYER2A3,
      BITRATE_MPEG2_LAYER1 // MPEG2.5
    ],
    null,
    [
      null,
      BITRATE_MPEG2_LAYER2A3,
      BITRATE_MPEG2_LAYER2A3,
      BITRATE_MPEG2_LAYER1 // MPEG2
    ],
    [null,
    BITRATE_MPEG1_LAYER3,
    BITRATE_MPEG1_LAYER2,
    BITRATE_MPEG1_LAYER1]
  ];

  return MP3;

}).call(this);

//# sourceMappingURL=mp3.js.map
