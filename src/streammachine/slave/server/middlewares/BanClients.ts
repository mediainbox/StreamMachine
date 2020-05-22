import {Logger} from "winston";
import express from "express";

export function banClientsMiddleware(blockedUserAgents: string[], logger: Logger): express.RequestHandler {
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
      stream: req.stream ? req.stream.getId() : null
    });

    res.status(403).end("Invalid User Agent.");
  };
}
