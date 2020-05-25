/*
require('@google-cloud/trace-agent').start
    projectId: process.env.GCLOUD_PROJECT
    keyFilename: process.env.GCLOUD_KEY_FILENAME
*/

import nconf from "nconf";
import {Master} from "./master/Master";

process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';
if (process.env.NEW_RELIC_APP_NAME && process.env.NEW_RELIC_LICENSE_KEY) {
  console.log('[integrations] loading NewRelic');
  require('newrelic');
}

nconf.env().argv();
nconf.file({
  file: nconf.get("config")
});

new Master(nconf.get());

setInterval(function() {
  //console.log("process alive timer");
}, 1000 * 60 * 60);
