
this.isGeolockEnabled = config.geolock?.enabled;
if (isGeolockEnabled) {
  this.logger.info("enable geolock for streams");
  this.countryLookup = maxmind.open(config.geolock.config_file);
}

// :stream parameter load and validation for requests
this.app.param("stream", (req, res, next, key) => {
  const stream = this.streams.get(key);

  if (!stream) {
    return res.status(404).end("Invalid stream.\n");
    return;
  }

  /*
  FIXME
  if (this.isGeolockEnabled && this.isGeolocked(req, stream)) {
    if (s.opts.geolock.fallback) {
      return res.redirect(302, s.opts.geolock.fallback);
    } else {
      return res.status(403).end("Invalid Country.");
    }
  }
  */

  req.stream = s;
  next();
});








//----------
isGeolocked(req, stream, opts) {
  var country, data, index, locked;
  locked = false;
  if (opts.geolock && opts.geolock.enabled) {
    data = this.countryLookup.get(req.ip);
    country = null;
    if (data && data.country) {
      country = data.country;
    }
    if (country && country.iso_code) {
      index = opts.geolock.countryCodes.indexOf(country.iso_code);
      if (opts.geolock.mode === "blacklist") {
        locked = index >= 0;
      } else {
        locked = index < 0;
      }
    }
    if (locked && country) {
      // request from invalid country...
      this.logger.debug(`Request from invalid country: ${country.names.es} (${country.iso_code})`, {
        ip: req.ip
      });
    }
  }
  return locked;
}
