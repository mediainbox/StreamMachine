
import {ConfigEvents, IConfigProvider} from "../IConfigProvider";
import {TypedEmitterClass} from "../../../helpers/events";
import {MasterConfig} from "../../types/config";
import axios from 'axios';

export class UrlConfigProvider extends TypedEmitterClass<ConfigEvents>() implements IConfigProvider {
  constructor(private readonly config: { url: string }) {
    super();
    this.watch();
  }

  read(): Promise<MasterConfig> {
    return axios.get(this.config.url).then(res => res.data as MasterConfig);
  }

  private watch() {
  }

}
