import {StreamsCollection} from "../../streams/StreamsCollection";

const uuid = require("uuid");
import express from "express";

export function trackingMiddleware(streams: StreamsCollection): express.RequestHandler {
  function getSessionId(req: express.Request) {
    return req.get('x-playback-session-id') ||
      req.query.session_id ||
      uuid.v4();
  }

  return function _trackingMiddleware(req, res, next) {
    // NOTE: session_id refers to the listening session, not the browser one

    let uniqListenerId = req.cookies.unique_listener_id;
    if (!uniqListenerId) {
      uniqListenerId = uuid.v4();
      res.cookie('unique_listener_id', uniqListenerId, {
        maxAge: 365 * 24 * 60 * 1000 // 1 year
      });
    }

    req.tracking = {
      session_id: getSessionId(req),
      unique_listener_id: uniqListenerId,
    };

    next();
  };
}
