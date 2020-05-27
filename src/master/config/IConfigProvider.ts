import {TypedEmitter} from "../../helpers/events";
import {MasterConfig} from "../types/config";

export interface ConfigEvents {
  update: (config: MasterConfig) => void;
}

export interface IConfigProvider extends TypedEmitter<ConfigEvents> {
  read(): Promise<MasterConfig>;
}
