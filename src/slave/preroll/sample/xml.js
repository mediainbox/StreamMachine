const axios = require('axios');
const xml2js = require('xml2js');

const parser = new xml2js.Parser({explicitArray: true, trim: true});

axios({
  method: 'get',
  url: 'http://demo.deliveryengine.adswizz.com/vast/4.0/request/alias/cad3testpub',
})
  .then( (response)  => {
    parser.parseStringPromise(response.data).then(parsed => console.dir(parsed, { depth: null }));
  })
  .catch(err => {
    console.error(err);
  });
