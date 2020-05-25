
// -- Hardcoded Source -- #

// This is an initial source like a proxy that should be connected from
// our end, rather than waiting for an incoming connection
import {IcecastUrlSource} from "../sources/types/IcecastUrlSource";

if (this.config.fallback != null) {
  // what type of a fallback is this?
  uri = URL.parse(this.config.fallback);
  newsource = (function () {
    switch (uri.protocol) {
      //case "file:":
      //return new FileSource();
      case "http:":
      case "https:":
        return new IcecastUrlSource({
          key: this.streamId,
          format: this.config.format,
          url: this.config.fallback,
          headers: this.config.headers,
          fallback: true,
          logger: this.logger
        }, {} as any);
      default:
        return null;
    }
  }).call(this);
  if (newsource) {
    newsource.once("connect", () => {
      return this.addSource(newsource, (err) => {
        if (err) {
          return this.logger.error("Connection to fallback source failed.");
        } else {
          return this.logger.debug("Fallback source connected.");
        }
      });
    });
    newsource.on("error", (err) => {
      return this.logger.error(`Fallback source error: ${err}`, {
        error: err
      });
    });
  } else {
    this.logger.error(`Unable to determine fallback source type for ${this.config.fallback}`);
  }
}
