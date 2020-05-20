// This is the code version that gets used when running via the compiled JS.
// Grunt will copy it to js/src/streammachine/modes/slave_worker.js

SlaveWorker   = require("../slave/slave_worker")

process.title = "StreamM:slaveWorker"

worker = new SlaveWorker()