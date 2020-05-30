import {ConfigEvents, IConfigProvider} from "./IConfigProvider";
import {TypedEmitterClass} from "../../helpers/events";
import * as fs from "fs";
import {promisify} from "util";
import * as path from "path";
import _ from "lodash";

export class FileConfigProvider<ConfigType> extends TypedEmitterClass<ConfigEvents<any>>() implements IConfigProvider<ConfigType> {
  private readonly filepath: string;
  private readonly current: ConfigType = null!;

  constructor(
    private readonly config: { filepath: string },
    private readonly parse: (data: any) => ConfigType,
  ) {
    super();

    this.filepath = path.resolve(process.cwd(), config.filepath);
    this.watch();
  }

  read(): Promise<ConfigType> {
    return promisify(fs.readFile)(this.filepath, 'utf8')
      .then(this.parse);
  }

  private watch() {
    fs.watch(this.filepath, _.throttle((event, filename) => {
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
            event,
            filename
          });
        });
    }, 500, { leading: false }));
  }
}
