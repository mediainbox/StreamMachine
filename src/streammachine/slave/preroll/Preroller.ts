import {Logger} from "winston";
import * as http from "http";
import {IAdOperator, PrerollerConfig} from "./types";
import {AdOperator} from "./AdOperator";
import {IListener,} from "../types";

const DEFAULT_AD_REQUEST_TIMEOUT = 500000;
const DEFAULT_AD_IMPRESSION_DELAY = 5000;

export class Preroller {
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

    this.config.adRequestTimeout = this.config.adRequestTimeout || DEFAULT_AD_REQUEST_TIMEOUT;
    this.config.impressionDelay = this.config.impressionDelay || DEFAULT_AD_IMPRESSION_DELAY;
  }

  getAdOperator(listener: IListener): IAdOperator {
    const adId = ++this.adRequests;

    // -- create an ad request -- #
    console.log('preroller: making ad request', {
      config: this.config
    });

    /*output.once("disconnect", () => {
      adRequest->abort
    });*/

    const handler = new AdOperator(
      String(adId),
      this.config,
      listener.getClient(),
      this.logger.child({
        component: `stream[${this.streamId}]:ad_operator[${adId}]`
      })
    );

    /*
    handler.on('error', () => {
      this.logger.error(`ad handler error for listener ${listener.id}`, {
        listener,
        adId,
      });
    });
     */

    return handler;
  }
}
