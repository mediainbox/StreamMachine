module.exports = function bannedClientsMiddleware(blockedUserAgents, logger) {
  const blockedRegex = RegExp(`${blockedUserAgents.join("|")}`);

  return function _bannedClientsMiddleware(req, res, next) {
    const ua = req.get('user-agent');
    const isBlocked = ua && blockedRegex.test(ua);

    if (!isBlocked) {
      next();
      return;
    }

    // request from banned agent...
    logger.debug(`request from banned User-Agent: ${ua}`, {
      ip: req.ip,
      url: req.url
    });

    res.status(403).end("Invalid User Agent.");
  };
}
