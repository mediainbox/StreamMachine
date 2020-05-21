import {IOutput} from "./IOutput";

const PumperOutput = require("./pumper");
const ShoutcastOutput = require("./shoutcast");
const RawOutput = require("./RawOutput");

module.exports = {
  outputs: [
    PumperOutput,
    ShoutcastOutput,
    RawOutput
  ],
}


export function makeOutput(args: {
  stream: Stream,
  req: express.Request
}): IOutput {
  return;
}
