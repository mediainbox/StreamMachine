import {ConfigEvents, IConfigProvider} from "./IConfigProvider";
import {TypedEmitterClass} from "../../helpers/events";
import axios from 'axios';
import {Minutes} from "../../types/util";
import _ from "lodash";

export class UrlConfigProvider<ConfigType> extends TypedEmitterClass<ConfigEvents<any>>() implements IConfigProvider<ConfigType> {
  private readonly current: ConfigType = null!;

  constructor(
    private readonly config: { url: string, refreshInterval?: Minutes },
    private readonly parse: (data: any) => ConfigType,
  ) {
    super();

    this.watch();
  }

  read(): Promise<ConfigType> {
    return axios
      .get(this.config.url)
      .then(res => this.parse(res.data));
  }

  private watch() {
    if (!this.config.refreshInterval) {
      return;
    }

    setInterval(() => {
      this
        .read()
        .then(config => {
          if (!_.isEqual(this.current, config)) {
            this.emit("update", config);
          }
        })
        .catch(error => {
          console.error('Error ocurred during config update', {
            error,
          });
        });
    }, this.config.refreshInterval * 60 * 1000);
  }
}
