import {Logger} from "winston";
import {IAdOperator, PrerollerConfig} from "./types";
import {AdOperator} from "./AdOperator";
import {IListener} from "../listeners/IListener";
import {IPreroller} from "./IPreroller";
import {EmptyReadable} from "../../util/EmptyReadable";

class NullAdOperator implements IAdOperator {
  async build() {
    return new EmptyReadable();
  }
  abort() {

  }
}

export class NullPreroller implements IPreroller {
  getAdOperator(listener: IListener): IAdOperator {
    return new NullAdOperator();
  }
}