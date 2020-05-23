const cluster = require('src/prueba/cluster');
const http = require('http');
const express = require('express');
const fs = require('fs');

const app = new express();

app.get('/test.mp3', (req, res) => {
  //res.status(200);
  //res.set('Content-Type', 'audio/mpeg');
  //res.set('Accept-Ranges', 'none');
  //res.chunkedEncoding = false;
  //res.useChunkedEncodingByDefault = false;
  //res._send('');

  console.log('request received')
  //res.useChunkedEncodingByDefault = false;

  setTimeout(() => {
    console.log('get stream')

    http.get('http://bbcmedia.ic.llnwd.net/stream/bbcmedia_radio2_mf_p', audio => {
      console.log('pipe');
      res.set('Content-Type', 'audio/mpeg');
      res.set('Transfer-Encoding', 'chunked')
      audio.pipe(res);
    });
  }, 100);
})

app.listen(8000, () => console.log('listening'));
