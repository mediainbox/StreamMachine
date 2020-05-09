const axios = require('axios');

axios.post('https://enzzas5m87d4s.x.pipedream.net', {},{
  params: {
    v: 1,
    tid: 'UA-165927993-1',
    t: 'pageview',
    dp: '/stream_test',
    ua: 'test_ua',
    cid: 'test_cid',
    uip: 'test_ip',
  }
})
