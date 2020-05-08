var MP3, _, firstHeader, headerCount, mp3;

MP3 = require("../streammachine/parsers/mp3");

_ = require("underscore");

mp3 = new MP3();

firstHeader = null;

headerCount = 0;

mp3.on("debug", (...msgs) => {
  return console.log(...msgs);
});

mp3.on("id3v1", (tag) => {
  return console.log("id3v1: ", tag);
});

mp3.on("id3v2", (tag) => {
  return console.log("id3v2: ", tag, tag.length);
});

//id3buf.read tag, (success,msg,data) =>
//    console.log "id3 return is ", success, msg, data
mp3.on("frame", (buf, obj) => {
  headerCount += 1;
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

process.stdin.pipe(mp3);
