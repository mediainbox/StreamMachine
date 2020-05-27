import {IConfigProvider} from "./IConfigProvider";
import {ConfigProviderConfig} from "../types/config";
import {UrlConfigProvider} from "./providers/UrlConfigProvider";
import {FileConfigProvider} from "./providers/FileConfigProvider";

export function makeConfigProvider(config: ConfigProviderConfig): IConfigProvider {
  if (config.type === 'file') {
    return new FileConfigProvider({
      filepath: config.filepath
    });
  }

  if (config.type === 'url') {
    return new UrlConfigProvider({
      url: config.url
    });
  }

  throw new Error(`Unsupported config provider type "${config.type}"`);
}
