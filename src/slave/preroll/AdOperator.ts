import {Logger} from "winston";
import {AdInstance} from "./AdInstance";
import axios from 'axios';
import {IAdOperator} from "./types";
import {Readable} from "stream";
import {parseAdResponse} from "./responseParser";
import {EmptyReadable} from "../../util/EmptyReadable";
import {Client} from "../listeners/Client";
import {AdsConfig} from "../config/types";
import {componentLogger} from "../../logger";

type Config = Omit<AdsConfig, 'serverUrl'> & {
  adUrl: string;
  streamKey: string;
};

/**
 * Class that will create an Ad instance, get its creative,
 * run its impression, and abort if error or requested.
 * If any error ocurrs during build, it should log and
 * return and empty preroll.
 */
export class AdOperator implements IAdOperator {
  private ad: AdInstance;
  private adRequestCancel?: () => void;
  private transcoderRequestCancel?: () => void;
  private transcoderResponse: Readable;
  private abortTimeout: NodeJS.Timeout;
  private impressionTimeout: NodeJS.Timeout;

  private isAborted = false;
  private isFinished = false;

  constructor(
    private readonly adId: string,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
  }

  async build(): Promise<Readable> {
    this.abortTimeout = this.abortOnTimeout();

    try {
      const serverResponse = await this.requestAd();
      const data = await parseAdResponse(serverResponse);

      this.ad = new AdInstance(this.adId, data);

      // call transcoder to get a version of the creative
      // that is matched to our specs
      const creativeResponse = await this.requestCreative();
      clearTimeout(this.abortTimeout);

      if (this.isAborted) {
        return new EmptyReadable();
      }

      if (this.ad.data.impressionUrl) {
        this.scheduleImpression();
      } else {
        this.logger.warn('skip impression call, no url found');
      }

      this.logger.debug('creative from transcoder built');

      return creativeResponse;
    } catch (error) {
      clearTimeout(this.abortTimeout);

      if (!axios.isCancel(error)) {
        this.logger.error('error ocurred during ad build', { error });
      }

      return new EmptyReadable();
    }
  }

  // fetch ad info from ad server
  private requestAd(): Promise<string> {
    this.logger.debug('request ad from server');

    return axios
      .get(this.config.adUrl, {
        cancelToken: new axios.CancelToken(cancel => {
          this.adRequestCancel = cancel;
        }),
      })
      .then(res => {
        this.logger.debug('got ok response from ad server');
        return res.data;
      });
  }

  // get transcoded ad audio from transcoding server
  private requestCreative(): Promise<Readable> {
    this.logger.debug('request creative from transcoder');

    return axios.get(this.config.transcoderUrl, {
      responseType: "stream",
      params: {
        uri: this.ad.data.creativeUrl,
        key: this.config.streamKey,
      },
      cancelToken: new axios.CancelToken(cancel => {
        this.transcoderRequestCancel = cancel;
      }),
    })
      .then(response => {
        this.transcoderResponse = response.data;

        this.transcoderResponse.on('end', () => this.isFinished = true);

        return this.transcoderResponse;
      });
  }

  private scheduleImpression() {
    this.logger.debug('start impression request');

    this.impressionTimeout = setTimeout(() => {
      axios
        .get<void>(this.ad.data.impressionUrl)
        .then(() => {
          this.logger.debug('impression request done');
        })
        .catch(error => {
          this.logger.debug('impression request failed', { error });
        })
    }, this.config.impressionDelay);
  }

  // if the preroll request can't be completed in time, abort
  private abortOnTimeout(): NodeJS.Timeout {
    return setTimeout(() => {
      this.logger.warn(`ad build timeout, abort`)
      this.abort();
    }, this.config.adTimeout);
  }

  private cleanup() {
    clearTimeout(this.abortTimeout);
    clearTimeout(this.impressionTimeout);
  }

  abort() {
    if (this.isAborted || this.isFinished) {
      return;
    }

    this.isAborted = true;

    // abort any existing requests
    this.adRequestCancel && this.adRequestCancel();
    this.transcoderRequestCancel && this.transcoderRequestCancel();

    this.transcoderResponse?.unpipe();
    this.transcoderResponse?.removeAllListeners();

    this.cleanup();
  }
}
