import {IOutput} from "./IOutput";
import express from "express";
import {Stream} from "../stream/Stream";
import {Logger} from "winston";
import {RawOutput} from "./RawOutput";
import {componentLogger} from "../../logger";

export function makeOutput(args: {
  stream: Stream,
  req: express.Request,
  res: express.Response,
  listenerId: string,
}): IOutput {
  return new RawOutput(
    args.req,
    args.res,
    args.stream.getFormat(),
    componentLogger(`stream[${args.stream.getId()}]:output_raw[#${args.listenerId}]`)
  );
}
