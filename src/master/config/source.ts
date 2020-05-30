import {SourceType} from "../types";
import {Type} from "../../helpers/types";

export type BaseSourceConfig = {
  readonly enabled: boolean;
  readonly id: string;
  readonly name?: string;
  readonly priority: number;
};

export type SourceConfig =
  | IcecastUrlConfig;

export type IcecastUrlConfig = BaseSourceConfig & Type<SourceType.ICECAST_URL, { url: string; }>;
//export type SourceInConfig = BaseSourceConfig & Type<SourceType.SOURCE_IN>;

