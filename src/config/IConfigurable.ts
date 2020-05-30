export interface IConfigurableConstructor<ConfigType> {
  new (config: ConfigType): IConfigurable<ConfigType>;
}

export interface IConfigurable<ConfigType> {
  reconfigure(config: ConfigType): void;
}
