import {Logger} from "winston";
import * as http from "http";
import {IAdOperator, PrerollerConfig} from "./types";
import {AdOperator} from "./AdOperator";
import {IListener} from "../listeners/IListener";
import {IPreroller} from "./IPreroller";

export class Preroller implements IPreroller {
  private adRequests = 0;
  private agent: http.Agent;

  constructor(
    private readonly streamId: string,
    private readonly config: PrerollerConfig,
    private readonly logger: Logger
  ) {
    if (!config.adUrl) {
      throw new Error('Missing "adUrl" value in preroller config');
    }

    if (!config.transcoderUrl) {
      throw new Error('Missing "transcoderUrl" value in preroller config');
    }

    // FIXME: Make these configurable
    this.agent = new http.Agent(); //keepAlive:true, maxSockets:100

    this.logger.info('preroller initialized', {
      config: this.config
    });
  }

  getAdOperator(listener: IListener): IAdOperator {
    const adId = ++this.adRequests;

    return new AdOperator(
      String(adId),
      this.config,
      listener.client,
      this.logger.child({
        component: `stream[${this.streamId}]:ad_operator[#${listener.id}]`
      })
    );
  }
}
