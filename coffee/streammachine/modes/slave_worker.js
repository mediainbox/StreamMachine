require("coffee-script/register")

SlaveWorker   = require("../slave/slave_worker")

process.title = "StreamM:slaveWorker"

worker = new SlaveWorker()