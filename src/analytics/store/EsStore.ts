import {Client, ClientOptions} from "@elastic/elasticsearch";
import {ListenData, SessionData, IStore} from "./IStore";
import {loadTemplates} from "./definitions/loadTemplates";
import {Logger} from "winston";
import {componentLogger} from "../../logger";
import {getIndexForTs} from "./helpers";

interface Config {
  readonly nodes: ClientOptions['nodes'];
  readonly indexPrefix: string;
}

/**
 * TODO:
 *   - index rollover
 */
export class EsStore implements IStore {
  private readonly es: Client;
  private readonly logger: Logger;

  constructor(private readonly config: Config) {
    this.es = new Client({
      nodes: config.nodes,
    });

    this.logger = componentLogger('elastic_store');
  }

  async initialize() {
    try {
      await loadTemplates(this.es, this.config);
      this.logger.info('Index templates loaded');
    } catch (error) {
      this.logger.error('Error ocurred during templates load', {
        error
      });
    }
  }

  async createSession(data: SessionData) {
    await this.es.index<Record<string, any>, SessionData>({
      index: getIndexForTs(`${this.config.indexPrefix}_sessions`, data.start),
      id: data.sessionId,
      body: data
    });
  }

  async updateSession(data: SessionData) {
    await this.es.update({
      index: getIndexForTs(`${this.config.indexPrefix}_sessions`, data.start),
      id: data.sessionId,
      body: {
        doc: data
      }
    });
  }

  async createListen(data: ListenData) {
    await this.es.index({
      index: getIndexForTs(`${this.config.indexPrefix}_listens`, data.datetime),
      body: data
    });
  }
}
