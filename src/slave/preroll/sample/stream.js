var Readable = require('src/slave/preroll/sample/stream').Readable

var s = new Readable()
s.push(null)

s.on('end', () => console.log('end'))

s.pipe(process.stdout);
