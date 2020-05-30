import {ConfigProviderConfig} from "./types";
import {argv} from "yargs";
import {IConfigurable, IConfigurableConstructor} from "./IConfigurable";
import {makeConfigProvider} from "./providers/providerFactory";

export function parseCommand(): ConfigProviderConfig {
  if (argv.configFile) {
    return {
      type: 'file',
      filepath: argv.configFile as string
    };
  } else if (argv.configUrl) {
    return {
      type: 'url',
      url: argv.url as string,
    };
  }

  throw new Error('Missing config provider arguments');
}

export function runConfigurable<ConfigType>(AppConstructor: IConfigurableConstructor<ConfigType>, parser: (data: any) => ConfigType) {
  const alive = setInterval(() => {}, 1000 * 60 * 60);
  const configProvider = makeConfigProvider(parseCommand(), parser);

  let app: IConfigurable<ConfigType>;

  configProvider
    .read()
    .then(config => {
      app = new AppConstructor(config);
    })
    .catch(error => {
      clearInterval(alive);
      console.error('Error ocurred while parsing initial config:', error);
      process.exit(1);
    });

  configProvider
    .on('update', config => {
      app.reconfigure(config);
    });
}
