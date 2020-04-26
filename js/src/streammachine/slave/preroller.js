var Preroller, debug, http, request, url, xmldom, xpath, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  __slice = [].slice;

_ = require("underscore");

http = require("http");

url = require("url");

request = require("request");

xmldom = require("xmldom");

xpath = require("xpath");

http = require("http");

debug = require("debug")("sm:slave:preroller");

module.exports = Preroller = (function() {
  function Preroller(stream, key, uri, transcode_uri, impressionDelay, cb) {
    this.stream = stream;
    this.key = key;
    this.uri = uri;
    this.transcode_uri = transcode_uri;
    this.impressionDelay = impressionDelay;
    this._counter = 1;
    this._config = null;
    if (!this.uri || !this.transcode_uri) {
      return cb(new Error("Preroller requires Ad URI and Transcoder URI"));
    }
    this.agent = new http.Agent;
    this.stream.log.debug("Preroller calling getStreamKey");
    this.stream.getStreamKey((function(_this) {
      return function(streamKey) {
        _this.streamKey = streamKey;
        _this.stream.log.debug("Preroller: Stream key is " + _this.streamKey + ". Ready to start serving.");
        return _this._config = {
          key: _this.key,
          streamKey: _this.streamKey,
          adURI: _this.uri,
          transcodeURI: _this.transcode_uri,
          impressionDelay: _this.impressionDelay,
          timeout: 2 * 1000,
          agent: _this.agent
        };
      };
    })(this));
    if (typeof cb === "function") {
      cb(null, this);
    }
  }

  Preroller.prototype.pump = function(output, writer, cb) {
    var aborted, adreq, count;
    cb = _.once(cb);
    aborted = false;
    if (!this._config) {
      cb(new Error("Preroll request without valid config."));
      return true;
    }
    if (output.disconnected) {
      cb(new Error("Preroll request got disconnected output."));
      return true;
    }
    count = this._counter++;
    adreq = new Preroller.AdRequest(output, writer, this._config, count, (function(_this) {
      return function(err) {
        if (err) {
          _this.stream.log.error(err);
        }
        return cb();
      };
    })(this));
    return adreq.on("error", (function(_this) {
      return function(err) {
        return _this.stream.log.error(err);
      };
    })(this));
  };

  Preroller.AdRequest = (function(_super) {
    __extends(AdRequest, _super);

    function AdRequest(output, writer, config, count, _cb) {
      this.output = output;
      this.writer = writer;
      this.config = config;
      this.count = count;
      this._cb = _cb;
      this._cb = _.once(this._cb);
      this._aborted = false;
      this._pumping = false;
      this._adreq = null;
      this._treq = null;
      this._tresp = null;
      this._impressionTimeout = null;
      this._abortL = (function(_this) {
        return function() {
          _this.debug("conn_pre_abort triggered");
          return _this._abort(null);
        };
      })(this);
      this.output.once("disconnect", this._abortL);
      this.uri = this.config.adURI.replace("!KEY!", this.config.streamKey).replace("!IP!", this.output.client.ip).replace("!STREAM!", this.config.key).replace("!UA!", encodeURIComponent(this.output.client.ua)).replace("!UUID!", this.output.client.session_id);
      this.debug("Ad request URI is " + this.uri);
      this._timeout = setTimeout((function(_this) {
        return function() {
          _this.debug("Preroll request timed out.");
          return _this._abort();
        };
      })(this), this.config.timeout);
      this._requestAd((function(_this) {
        return function(err, _ad) {
          _this._ad = _ad;
          if (err) {
            return _this._cleanup(err);
          }
          return _this._requestCreative(_this._ad, function(err) {
            if (err) {
              return _this._cleanup(err);
            }
            _this._armImpression(_this._ad);
            _this.debug("Ad request finished.");
            return _this._cleanup(null);
          });
        };
      })(this));
    }

    AdRequest.prototype._requestAd = function(cb) {
      return this._adreq = request.get(this.uri, (function(_this) {
        return function(err, res, body) {
          if (err) {
            return cb(new Error("Ad request returned error: " + err));
          }
          if (res.statusCode === 200) {
            return new Preroller.AdObject(body, function(err, obj) {
              if (err) {
                return cb(new Error("Ad request was unsuccessful: " + err));
              } else {
                return cb(null, obj);
              }
            });
          } else {
            return cb(new Error("Ad request returned non-200 response: " + body));
          }
        };
      })(this));
    };

    AdRequest.prototype._requestCreative = function(ad, cb) {
      if (!ad.creativeURL) {
        return cb(null);
      }
      this.debug("Preparing transcoder request for " + ad.creativeURL + " with key " + this.config.streamKey + ".");
      return this._treq = request.get({
        uri: this.config.transcodeURI,
        agent: this.config.agent,
        qs: {
          uri: ad.creativeURL,
          key: this.config.streamKey
        }
      }).once("response", (function(_this) {
        return function(_tresp) {
          _this._tresp = _tresp;
          _this.debug("Transcoder response received: " + _this._tresp.statusCode);
          if (_this._tresp.statusCode === 200) {
            _this.debug("Piping tresp to writer");
            _this._tresp.pipe(_this.writer, {
              end: false
            });
            return _this._tresp.once("end", function() {
              var _ref, _ref1;
              _this.debug("Transcoder sent " + (((_ref = _this._tresp) != null ? (_ref1 = _ref.socket) != null ? _ref1.bytesRead : void 0 : void 0) || "UNKNOWN") + " bytes");
              if (!_this._aborted) {
                _this.debug("Transcoder pipe completed successfully.");
                return cb(null);
              }
            });
          } else {
            return cb(new Error("Non-200 response from transcoder."));
          }
        };
      })(this)).once("error", (function(_this) {
        return function(err) {
          return cb(new Error("Transcoder request error: " + err));
        };
      })(this));
    };

    AdRequest.prototype._armImpression = function(ad) {
      var disarm;
      this._impressionTimeout = setTimeout((function(_this) {
        return function() {
          _this.output.removeListener("disconnect", disarm);
          process.nextTick(function() {
            var disarm;
            disarm = null;
            return this._impressionTimeout = null;
          });
          if (ad.impressionURL) {
            return request.get(ad.impressionURL, function(err, resp, body) {
              if (err) {
                return _this.emit("error", new Error("Failed to hit impression URL " + ad.impressionURL + ": " + err));
              } else {
                return _this.debug("Impression URL hit successfully for " + _this.output.client.session_id + ".");
              }
            });
          } else {
            return _this.debug("No impression URL found.");
          }
        };
      })(this), this.config.impressionDelay);
      this.debug("Arming impression for " + this.config.impressionDelay + "ms");
      disarm = (function(_this) {
        return function() {
          _this.debug("Disarming impression after early abort.");
          if (_this._impressionTimeout) {
            return clearTimeout(_this._impressionTimeout);
          }
        };
      })(this);
      return this.output.once("disconnect", disarm);
    };

    AdRequest.prototype.debug = function() {
      var args, msg;
      msg = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      return debug.apply(null, [("" + this.count + ": ") + msg].concat(__slice.call(args)));
    };

    AdRequest.prototype._abort = function(err) {
      var _ref, _ref1, _ref2;
      this._aborted = true;
      if ((_ref = this._adreq) != null) {
        _ref.abort();
      }
      if ((_ref1 = this._treq) != null) {
        _ref1.abort();
      }
      if ((_ref2 = this._tresp) != null) {
        _ref2.unpipe();
      }
      return this._cleanup(err);
    };

    AdRequest.prototype._cleanup = function(err) {
      this.debug("In _cleanup: " + err);
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this.output.removeListener("disconnect", this._abortL);
      return this._cb(err);
    };

    return AdRequest;

  })(require("events").EventEmitter);

  Preroller.AdObject = (function() {
    function AdObject(xmldoc, cb) {
      var ad, creative, doc, error, impression, mediafile, wrapper, _ref, _ref1, _ref2, _ref3, _ref4, _ref5;
      this.creativeURL = null;
      this.impressionURL = null;
      this.doc = null;
      debug("Parsing ad object XML");
      doc = new xmldom.DOMParser().parseFromString(xmldoc);
      debug("XML doc parsed.");
      if (wrapper = (_ref = xpath.select("/VAST", doc)) != null ? _ref[0] : void 0) {
        debug("VAST wrapper detected");
        if (ad = (_ref1 = xpath.select("Ad/InLine", wrapper)) != null ? _ref1[0] : void 0) {
          debug("Ad document found.");
          if (creative = (_ref2 = xpath.select("./Creatives/Creative/Linear", ad)) != null ? _ref2[0] : void 0) {
            if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mpeg']/text())", creative)) {
              debug("MP3 Media File is " + mediafile);
              this.creativeURL = mediafile;
            } else if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mp4']/text())", creative)) {
              debug("MP4 Media File is " + mediafile);
              this.creativeURL = mediafile;
            } else if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/aac']/text())", creative)) {
              debug("AAC Media File is " + mediafile);
              this.creativeURL = mediafile;
            }
          }
          if (impression = xpath.select("string(./Impression/text())", ad)) {
            debug("Impression URL is " + impression);
            this.impressionURL = impression;
          }
          return cb(null, this);
        } else {
          return cb(null, null);
        }
      }
      if (wrapper = (_ref3 = xpath.select("/DAAST", doc)) != null ? _ref3[0] : void 0) {
        debug("DAAST wrapper detected");
        if (ad = (_ref4 = xpath.select("Ad/InLine", wrapper)) != null ? _ref4[0] : void 0) {
          debug("Ad document found.");
          if (creative = (_ref5 = xpath.select("./Creatives/Creative/Linear", ad)) != null ? _ref5[0] : void 0) {
            if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mpeg']/text())", creative)) {
              debug("MP3 Media File is " + mediafile);
              this.creativeURL = mediafile;
            } else if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mp4']/text())", creative)) {
              debug("MP4 Media File is " + mediafile);
              this.creativeURL = mediafile;
            }
          }
          if (impression = xpath.select("string(./Impression/text())", ad)) {
            debug("Impression URL is " + impression);
            this.impressionURL = impression;
          }
          return cb(null, this);
        } else {
          if (error = xpath.select("string(./Error/text())", wrapper)) {
            debug("Error URL found: " + error);
            this.impressionURL = error;
            this.impressionURL = this.impressionURL.replace("[ERRORCODE]", 303);
            return cb(null, this);
          } else {
            return cb(null, null);
          }
        }
      }
      cb(new Error("Unsupported ad format"));
    }

    return AdObject;

  })();

  return Preroller;

})();

//# sourceMappingURL=preroller.js.map
