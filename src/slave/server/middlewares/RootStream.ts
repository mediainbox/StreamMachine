import {StreamsCollection} from "../../streams/StreamsCollection";
import express from "express";

export function rootStreamRewrite(streams: StreamsCollection): express.RequestHandler {
  return function _rootStreamRewrite(req, res, next) {
    if (streams.count()) {
      if (req.url === '/' || req.url === "/;stream.nsv" || req.url === "/;") {
        req.url = `/${streams.first()!.getId()}`;
      }
    }

    next();
  };
}
