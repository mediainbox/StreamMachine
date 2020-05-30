/*
require('@google-cloud/trace-agent').start
    projectId: process.env.GCLOUD_PROJECT
    keyFilename: process.env.GCLOUD_KEY_FILENAME
*/

import {Master} from "./master/Master";
import {validateMasterConfig} from "./master/config";
import {runConfigurable} from "./config/runner";

process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';
if (process.env.NEW_RELIC_APP_NAME && process.env.NEW_RELIC_LICENSE_KEY) {
  console.log('[integrations] loading NewRelic');
  require('newrelic');
}

runConfigurable(Master, validateMasterConfig);
