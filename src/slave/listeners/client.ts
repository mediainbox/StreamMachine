import express from "express";
import {ClientData} from "../../types";
import { UAParser } from 'ua-parser-js';

// TODO: move to global
export function clientFromRequest(req: express.Request): ClientData {
  const ua = req.query.ua as string || req.get('user-agent') || '';
  const parsedUa = new UAParser(req.headers['user-agent']);

  return {
    ip: req.ip,
    path: req.url,
    ua,
    device: {
      type: parsedUa.getDevice().type || null,
      os: parsedUa.getOS().name || null,
      browser: parsedUa.getBrowser().name || null,
    }
  };
}
