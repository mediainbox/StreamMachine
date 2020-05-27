/*
require('@google-cloud/trace-agent').start
    projectId: process.env.GCLOUD_PROJECT
    keyFilename: process.env.GCLOUD_KEY_FILENAME
*/

import {Master} from "./master/Master";
import {ConfigProviderConfig} from "./master/types/config";
import { argv } from "yargs";

process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';
if (process.env.NEW_RELIC_APP_NAME && process.env.NEW_RELIC_LICENSE_KEY) {
  console.log('[integrations] loading NewRelic');
  require('newrelic');
}

let pConfig: ConfigProviderConfig;

if (argv.configFile) {
  pConfig = {
    type: 'file',
    filepath: argv.configFile as string
  };
} else if (argv.configUrl) {
  pConfig = {
    type: 'url',
    url: argv.url as string,
  };
} else {
  throw new Error('Missing config provider arguments');
}

new Master(pConfig);

setInterval(function () {
  //console.log("process alive timer");
}, 1000 * 60 * 60);
