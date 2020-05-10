module.exports = function bannedClientsMiddleware(blockedUserAgents, logger) {
  const blockedRegex = RegExp(`${blockedUserAgents.join("|")}`);

  return function _bannedClientsMiddleware(req, res, next) {
    const ua = req.get('user-agent');
    const isBlocked = ua && blockedRegex.test(ua);

    if (!isBlocked) {
      next();
      return;
    }

    logger.debug(`request from banned user-agent: ${ua}`, {
      ip: req.ip,
      url: req.url,
      stream: req.stream ? req.stream.key : null
    });

    res.status(403).end("Invalid User Agent.");
  };
}
