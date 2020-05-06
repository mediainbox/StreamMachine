var Preroller, _, debug, http, request, url, xmldom, xpath;

_ = require("underscore");

http = require("http");

url = require("url");

request = require("request");

xmldom = require("xmldom");

xpath = require("xpath");

http = require("http");

debug = require("debug")("sm:slave:preroller");

module.exports = Preroller = (function() {
  class Preroller {
    constructor(stream, key, uri, transcode_uri, impressionDelay, cb) {
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
      // FIXME: Make these configurable
      this.agent = new http.Agent(); //keepAlive:true, maxSockets:100
      
      // -- need to look at the stream to get characteristics -- #
      this.stream.log.debug("Preroller calling getStreamKey");
      this.stream.getStreamKey((streamKey) => {
        this.streamKey = streamKey;
        this.stream.log.debug(`Preroller: Stream key is ${this.streamKey}. Ready to start serving.`);
        return this._config = {
          key: this.key,
          streamKey: this.streamKey,
          adURI: this.uri,
          transcodeURI: this.transcode_uri,
          impressionDelay: this.impressionDelay,
          timeout: 2 * 1000,
          agent: this.agent
        };
      });
      if (typeof cb === "function") {
        cb(null, this);
      }
    }

    //----------
    pump(output, writer, cb) {
      var aborted, adreq, count;
      cb = _.once(cb);
      aborted = false;
      if (!this._config) {
        cb(new Error("Preroll request without valid config."));
        return true;
      }
      // short-circuit if the output has already disconnected
      if (output.disconnected) {
        cb(new Error("Preroll request got disconnected output."));
        return true;
      }
      count = this._counter++;
      // -- create an ad request -- #
      adreq = new Preroller.AdRequest(output, writer, this._config, count, (err) => {
        if (err) {
          this.stream.log.error(err);
        }
        return cb();
      });
      return adreq.on("error", (err) => {
        return this.stream.log.error(err);
      });
    }

  };

  //----------
  Preroller.AdRequest = class AdRequest extends require("events").EventEmitter {
    constructor(output1, writer1, config, count1, _cb) {
      super();
      this.output = output1;
      this.writer = writer1;
      this.config = config;
      this.count = count1;
      this._cb = _cb;
      this._cb = _.once(this._cb);
      this._aborted = false;
      this._pumping = false;
      this._adreq = null;
      this._treq = null;
      this._tresp = null;
      this._impressionTimeout = null;
      // -- Set up an abort listener -- #
      this._abortL = () => {
        this.debug("conn_pre_abort triggered");
        return this._abort(null);
      };
      this.output.once("disconnect", this._abortL);
      // -- Set up our ad URI -- #
      this.uri = this.config.adURI.replace("!KEY!", this.config.streamKey).replace("!IP!", this.output.client.ip).replace("!STREAM!", this.config.key).replace("!UA!", encodeURIComponent(this.output.client.ua)).replace("!UUID!", this.output.client.session_id);
      this.debug(`Ad request URI is ${this.uri}`);
      // -- Set a timeout -- #

      // If the preroll request can't be completed in time, abort and move on
      this._timeout = setTimeout(() => {
        this.debug("Preroll request timed out.");
        return this._abort();
      }, this.config.timeout);
      // -- Request an ad -- #
      this._requestAd((err, _ad) => {
        this._ad = _ad;
        if (err) {
          return this._cleanup(err);
        }
        // Now that we have an ad object, we call the transcoder to
        // get a version of the creative that is matched to our specs
        return this._requestCreative(this._ad, (err) => {
          if (err) {
            return this._cleanup(err);
          }
          // if we didn't get an error, that means the creative was
          // successfully piped to our output. We should arm the
          // impression function
          this._armImpression(this._ad);
          // and trigger our callback
          this.debug("Ad request finished.");
          return this._cleanup(null);
        });
      });
    }

    //----------

      // Request an ad from the ad server
    _requestAd(cb) {
      return this._adreq = request.get(this.uri, (err, res, body) => {
        if (err) {
          return cb(new Error(`Ad request returned error: ${err}`));
        }
        if (res.statusCode === 200) {
          return new Preroller.AdObject(body, (err, obj) => {
            if (err) {
              return cb(new Error(`Ad request was unsuccessful: ${err}`));
            } else {
              return cb(null, obj);
            }
          });
        } else {
          return cb(new Error(`Ad request returned non-200 response: ${body}`));
        }
      });
    }

    //----------

      // Request transcoded creative from the transcoder
    _requestCreative(ad, cb) {
      if (!ad.creativeURL) {
        // if the ad doesn't have a creativeURL, just call back
        // immediately with no error
        return cb(null);
      }
      this.debug(`Preparing transcoder request for ${ad.creativeURL} with key ${this.config.streamKey}.`);
      return this._treq = request.get({
        uri: this.config.transcodeURI,
        agent: this.config.agent,
        qs: {
          uri: ad.creativeURL,
          key: this.config.streamKey
        }
      }).once("response", (_tresp) => {
        this._tresp = _tresp;
        this.debug(`Transcoder response received: ${this._tresp.statusCode}`);
        if (this._tresp.statusCode === 200) {
          this.debug("Piping tresp to writer");
          this._tresp.pipe(this.writer, {
            end: false
          });
          return this._tresp.once("end", () => {
            var ref, ref1;
            this.debug(`Transcoder sent ${((ref = this._tresp) != null ? (ref1 = ref.socket) != null ? ref1.bytesRead : void 0 : void 0) || "UNKNOWN"} bytes`);
            if (!this._aborted) {
              this.debug("Transcoder pipe completed successfully.");
              return cb(null);
            }
          });
        } else {
          return cb(new Error("Non-200 response from transcoder."));
        }
      }).once("error", (err) => {
        return cb(new Error(`Transcoder request error: ${err}`));
      });
    }

    //----------
    _armImpression(ad) {
      var disarm;
      this._impressionTimeout = setTimeout(() => {
        this.output.removeListener("disconnect", disarm);
        process.nextTick(function() {
          var disarm;
          disarm = null;
          return this._impressionTimeout = null;
        });
        if (ad.impressionURL) {
          return request.get(ad.impressionURL, (err, resp, body) => {
            if (err) {
              return this.emit("error", new Error(`Failed to hit impression URL ${ad.impressionURL}: ${err}`));
            } else {
              return this.debug(`Impression URL hit successfully for ${this.output.client.session_id}.`);
            }
          });
        } else {
          return this.debug("No impression URL found.");
        }
      }, this.config.impressionDelay);
      this.debug(`Arming impression for ${this.config.impressionDelay}ms`);
      // -- impression abort -- #
      disarm = () => {
        this.debug("Disarming impression after early abort.");
        if (this._impressionTimeout) {
          return clearTimeout(this._impressionTimeout);
        }
      };
      return this.output.once("disconnect", disarm);
    }

    //----------
    debug(msg, ...args) {
      return debug(`${this.count}: ` + msg, ...args);
    }

    //----------
    _abort(err) {
      var ref, ref1, ref2;
      this._aborted = true;
      // abort any existing requests
      if ((ref = this._adreq) != null) {
        ref.abort();
      }
      if ((ref1 = this._treq) != null) {
        ref1.abort();
      }
      // make sure we don't write any more
      if ((ref2 = this._tresp) != null) {
        ref2.unpipe();
      }
      return this._cleanup(err);
    }

    _cleanup(err) {
      this.debug(`In _cleanup: ${err}`);
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this.output.removeListener("disconnect", this._abortL);
      return this._cb(err);
    }

  };

  //----------
  Preroller.AdObject = class AdObject {
    constructor(xmldoc, cb) {
      var ad, creative, doc, error, impression, mediafile, ref, ref1, ref2, ref3, ref4, ref5, wrapper;
      this.creativeURL = null;
      this.impressionURL = null;
      this.doc = null;
      debug("Parsing ad object XML");
      doc = new xmldom.DOMParser().parseFromString(xmldoc);
      debug("XML doc parsed.");
      // -- VAST Support -- #
      if (wrapper = (ref = xpath.select("/VAST", doc)) != null ? ref[0] : void 0) {
        debug("VAST wrapper detected");
        if (ad = (ref1 = xpath.select("Ad/InLine", wrapper)) != null ? ref1[0] : void 0) {
          debug("Ad document found.");
          // find our linear creative
          if (creative = (ref2 = xpath.select("./Creatives/Creative/Linear", ad)) != null ? ref2[0] : void 0) {
            // find the mpeg mediafile
            if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mpeg']/text())", creative)) {
              debug(`MP3 Media File is ${mediafile}`);
              this.creativeURL = mediafile;
            } else if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mp4']/text())", creative)) {
              debug(`MP4 Media File is ${mediafile}`);
              this.creativeURL = mediafile;
            } else if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/aac']/text())", creative)) {
              debug(`AAC Media File is ${mediafile}`);
              this.creativeURL = mediafile;
            }
          }
          // find the impression URL
          if (impression = xpath.select("string(./Impression/text())", ad)) {
            debug(`Impression URL is ${impression}`);
            this.impressionURL = impression;
          }
          return cb(null, this);
        } else {
          // VAST wrapper but no ad
          return cb(null, null);
        }
      }
      // -- DAAST Support -- #
      if (wrapper = (ref3 = xpath.select("/DAAST", doc)) != null ? ref3[0] : void 0) {
        debug("DAAST wrapper detected");
        if (ad = (ref4 = xpath.select("Ad/InLine", wrapper)) != null ? ref4[0] : void 0) {
          debug("Ad document found.");
          // find our linear creative
          if (creative = (ref5 = xpath.select("./Creatives/Creative/Linear", ad)) != null ? ref5[0] : void 0) {
            // find the mpeg mediafile
            if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mpeg']/text())", creative)) {
              debug(`MP3 Media File is ${mediafile}`);
              this.creativeURL = mediafile;
            } else if (mediafile = xpath.select("string(./MediaFiles/MediaFile[@type='audio/mp4']/text())", creative)) {
              debug(`MP4 Media File is ${mediafile}`);
              this.creativeURL = mediafile;
            }
          }
          // find the impression URL
          if (impression = xpath.select("string(./Impression/text())", ad)) {
            debug(`Impression URL is ${impression}`);
            this.impressionURL = impression;
          }
          return cb(null, this);
        } else {
          // DAAST wrapper but no ad

          // Is there an error element? If so, we're supposed to hit
          // it as our impression URL
          if (error = xpath.select("string(./Error/text())", wrapper)) {
            debug(`Error URL found: ${error}`);
            this.impressionURL = error;
            // for a no ad error url, look for an [ERRORCODE] macro
            // and replace it with 303, because DAAST says so

            // FIXME: Technically, I think this response is intended
            // for the case where we had a wrapper and hit that URL
            // but got no response. We don't support that case yet,
            // but I think it's ok to send 303 here
            this.impressionURL = this.impressionURL.replace("[ERRORCODE]", 303);
            return cb(null, this);
          } else {
            return cb(null, null);
          }
        }
      }
      cb(new Error("Unsupported ad format"));
    }

  };

  return Preroller;

}).call(this);

//# sourceMappingURL=preroller.js.map
