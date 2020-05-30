import {Logger} from "winston";
import * as http from "http";
import {IAdOperator} from "./types";
import {AdOperator} from "./AdOperator";
import {IListener} from "../listeners/IListener";
import {IPreroller} from "./IPreroller";
import {componentLogger} from "../../logger";
import {AdsConfig} from "../../types/ads";

export class Preroller implements IPreroller {
  private adRequests = 0;
  private agent: http.Agent;
  private readonly logger: Logger;

  constructor(
    private readonly streamId: string,
    private readonly config: AdsConfig,
  ) {
    this.logger = componentLogger(`preroller[${streamId}]`);

    if (!config.serverUrl) {
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

    const adUrl = this.config.serverUrl
        .replace("!KEY!", this.streamId) // FIXME
        .replace("!STREAM!", this.streamId)
        .replace("!IP!", listener.getClient().ip)
        .replace("!UA!", encodeURIComponent(listener.getClient().ua))
        .replace("!UUID!", listener.getSessionId());

    return new AdOperator(
      String(adId),
      {
        ...this.config,
        adUrl,
        streamKey: this.streamId,
      },
      componentLogger(`stream[${this.streamId}]:ad_operator[#${listener.getId()}]`)
    );
  }
}
