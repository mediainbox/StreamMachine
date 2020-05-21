module.exports = function rootStreamRewrite(streams) {
  return function _rootStreamRewrite(req, res, next) {
    if (streams.count()) {
      if (req.url === '/' || req.url === "/;stream.nsv" || req.url === "/;") {
        req.url = `/${streams.first().getId()}`;
      }
    }

    next();
  };
}
