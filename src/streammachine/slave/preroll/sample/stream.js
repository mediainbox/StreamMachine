var Readable = require('stream').Readable

var s = new Readable()
s.push(null)

s.on('end', () => console.log('end'))

s.pipe(process.stdout);
