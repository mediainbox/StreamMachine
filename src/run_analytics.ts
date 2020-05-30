import nconf from "nconf";
import {Analytics} from "./analytics/Analytics";
import {argv} from "yargs";

nconf.env().argv();
nconf.file({
  file: argv.configFile as string
});

new Analytics(nconf.get());

setInterval(() => {}, 1000 * 60 * 60);
