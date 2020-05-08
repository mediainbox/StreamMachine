var AAC, _, aac, ema, ema_alpha, firstHeader, headerCount;

AAC = require("../streammachine/parsers/aac");

_ = require("underscore");

aac = new AAC();

firstHeader = null;

headerCount = 0;

ema_alpha = 2 / (40 + 1);

ema = null;

aac.on("frame", (buf, header) => {
  var bitrate;
  headerCount += 1;
  bitrate = header.frame_length / header.duration * 1000 * 8;
  ema || (ema = bitrate);
  ema = ema_alpha * bitrate + (1 - ema_alpha) * ema;
  console.log(`header ${headerCount}: ${bitrate} (${Math.round(ema / 1000)})`);
  return true;
  if (firstHeader) {
    if (_.isEqual(firstHeader, obj)) {

    } else {
      // do nothing
      return console.log(`Header ${headerCount}: `, obj);
    }
  } else {
    firstHeader = obj;
    return console.log("First header: ", obj);
  }
});

process.stdin.pipe(aac);
