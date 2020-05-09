const uuid = require("uuid");

module.exports = function trackingMiddleware(streams) {
  function getSessionId(req) {
    return req.get('x-playback-session-id') ||
      req.query.session_id ||
      uuid.v4();
  }

  return function _trackingMiddleware(req, res, next) {
    req.tracking = {};
    // NOTE: session_id refers to the listening session, not the browser one
    req.tracking.session_id = getSessionId(req);

    let uniqListenerId = req.cookies.unique_listener_id;
    if (!uniqListenerId) {
      uniqListenerId = uuid.v4();
      res.cookie('unique_listener_id', uuid.v4(), {
        maxAge: 365 * 24 * 60 * 1000 // 1 year
      });
    }

    req.tracking.unique_listener_id = uniqListenerId;

    next();
  };
}
