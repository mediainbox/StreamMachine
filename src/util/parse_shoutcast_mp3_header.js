var Icy, MP3, _, firstHeader, headerCount, icyreader, mp3;

MP3 = require("../streammachine/parsers/mp3");

_ = require("lodash");

mp3 = new MP3();

Icy = require('icy');

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
      return console.log(`Header ${headerCount} (${buf.length}): `, obj);
    }
  } else {
    firstHeader = obj;
    return console.log("First header: ", obj);
  }
});

icyreader = new Icy.Reader(32768);

process.stdin.pipe(icyreader).pipe(mp3);
