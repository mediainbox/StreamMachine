const cluster = require('src/_prueba/cluster');
const axios = require('axios');
const http = require('http');
const express = require('express');
const fs = require('fs');

if (cluster.isMaster) {
  console.log('master pid ' + process.pid);

  // init cluster
  require('os').cpus().forEach(() => {
    console.log('forking');
    cluster.fork();
  });

  // add eventlisteners
  Object.values(cluster.workers).forEach(worker => {
    worker.on('message', (message, handle) => {
      console.log((new Date()) + ' MASTER received message:' + message);

      if (handle) {
        axios.get('https://c3ny1.mediainbox.net/cadena3.mp3', {
          responseType: 'stream'
        }).then(response => {
          console.log('piping response');

          response.data.pipe(handle);
        });
      }
    });
  });

  cluster.on('exit', (worker, code, signal) => {
    console.log('worker %d died (%s). restarting...',
      worker.process.pid, signal || code);
    cluster.fork();
  });
} else {
  console.log('worker id ' + cluster.worker.id);

  const app = new express();

  app.get('/stream', (req, res) => {
    res.status(200);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Accept-Ranges', 'none');
    //res.chunkedEncoding = false;
    //res.useChunkedEncodingByDefault = false;
    //res._send('');

    //process.send('sending response from id ' + cluster.worker.id, res.connection);

    const stream = fs.createReadStream(__dirname + '/audio.mp3');
    console.log('piping audio');
    stream.pipe(res);
  })

  app.listen(8000);
}
