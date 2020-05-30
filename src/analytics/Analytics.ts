import {EventsProcessor} from "./EventsProcessor";
import {componentLogger, createLogger} from "../logger";
import {AnalyticsConfig} from "./types/config";
import {Logger} from "winston";
import {EventsListener} from "./EventsListener";
import {EsStore} from "./store/EsStore";
import {validateAnalyticsConfig} from "./config";

export class Analytics {
  private readonly eventsProcessor: EventsProcessor;
  private readonly eventsListener: EventsListener;
  private readonly logger: Logger;
  private readonly config: AnalyticsConfig;

  constructor(readonly _config: AnalyticsConfig) {
    const config = this.config = validateAnalyticsConfig(_config);

    createLogger('analytics', config.log);
    this.logger = componentLogger('main');

    this.eventsListener = new EventsListener();

    const store = new EsStore({
      nodes: config.elastic.nodes,
      indexPrefix: 'dev1',
    });

    store.initialize().catch(console.error);

    this.eventsProcessor = new EventsProcessor(
      this.eventsListener,
      store,
    );
  }
}
