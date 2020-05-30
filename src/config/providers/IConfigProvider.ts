import {TypedEmitter} from "../../helpers/events";

export interface ConfigEvents<ConfigType> {
  update: (config: ConfigType) => void;
}

export interface IConfigProvider<ConfigType> extends TypedEmitter<ConfigEvents<ConfigType>> {
  read(): Promise<ConfigType>;
}
