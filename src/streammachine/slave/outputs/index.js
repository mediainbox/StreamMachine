const PumperOutput = require("./pumper");
const ShoutcastOutput = require("./shoutcast");
const RawOutput = require("./raw_audio");

module.exports = {
  outputs: [
    PumperOutput,
    ShoutcastOutput,
    RawOutput
  ],
}
