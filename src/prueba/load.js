const cluster = require('src/prueba/cluster');
const http = require('http');
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = new express();
var devnull = require('dev-null');


let listeners = 1000;
while(listeners--) {
  const l = listeners;
  axios.get('http://localhost:9002/', {
    responseType: 'stream'
  })
    .then(res => {
      console.log('connected ' + l)
      res.data.pipe(devnull());

      res.data.on('data', () => {
        //console.log(new Date().toISOString() +    ' data');
      })

      res.data.on('error', (err) => {
        console.log(new Date().toISOString() +    ' err', err);
      })
    })
    .catch(err => console.log(err));
}
