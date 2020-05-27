import {ConfigEvents, IConfigProvider} from "../IConfigProvider";
import {TypedEmitterClass} from "../../../helpers/events";
import {MasterConfig} from "../../types/config";
import * as fs from "fs";
import {promisify} from "util";
import * as path from "path";
import _ from "lodash";

export class FileConfigProvider extends TypedEmitterClass<ConfigEvents>() implements IConfigProvider {
  private readonly filepath: string;

  constructor(private readonly config: { filepath: string }) {
    super();

    this.filepath = path.resolve(process.cwd(), config.filepath);

    if (!fs.existsSync(this.filepath)) {
      throw new Error(`Config file "${this.filepath}" does not exists`);
    }

    this.watch();
  }

  read(): Promise<MasterConfig> {
    return promisify(fs.readFile)(this.filepath, 'utf8')
      .then(data => {
        return JSON.parse(data) as MasterConfig;
      });
  }

  private watch() {
    fs.watch(this.filepath, _.throttle((event, filename) => {
      this.read().then(config => {
        this.emit("update", config);
      }).catch(error => {
        console.error('Could not read updated config file', {
          error,
          event,
          filename
        });
      });
    }, 500, { leading: false }));
  }
}
