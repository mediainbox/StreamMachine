import {IAdOperator} from "./types";
import {IListener} from "../listeners/IListener";

export interface IPreroller {
  getAdOperator(listener: IListener): IAdOperator;
}
