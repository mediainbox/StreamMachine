import {Slave} from './slave/Slave';
import {parseCommand, runConfigurable} from "./config/runner";
import {Master} from "./master/Master";
import {validateMasterConfig} from "./master/config";

process.env.NEW_RELIC_NO_CONFIG_FILE = 'true';
if (process.env.NEW_RELIC_APP_NAME && process.env.NEW_RELIC_LICENSE_KEY) {
  console.log('[integrations] loading NewRelic');
  require('newrelic');
}

new Slave(parseCommand());

setInterval(function () {
  //console.log("process alive timer");
}, 1000 * 60 * 60);
