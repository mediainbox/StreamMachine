import {IConfigProvider} from "./IConfigProvider";
import {UrlConfigProvider} from "./UrlConfigProvider";
import {FileConfigProvider} from "./FileConfigProvider";
import {ConfigProviderConfig} from "../types";


export function makeConfigProvider<ConfigType>(config: ConfigProviderConfig, parser: (data: any) => ConfigType): IConfigProvider<ConfigType> {
  if (config.type === 'file') {
    return new FileConfigProvider(config, parser) as IConfigProvider<ConfigType>;
  }

  if (config.type === 'url') {
    return new UrlConfigProvider(config, parser) as IConfigProvider<ConfigType>;
  }

  throw new Error(`Unsupported config provider found: ${JSON.stringify(config)}`);
}
