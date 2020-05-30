import {TypedEmitterClass} from "../helpers/events";
import {ListenerEvents, ListenerEventType} from "../events/listener";
import {Job, Worker} from 'bullmq';
import {Logger} from "winston";
import {componentLogger} from "../logger";

type HandledEvents = ListenerEvents;

export class EventsListener extends TypedEmitterClass<HandledEvents>() {
  private readonly worker: Worker;
  private readonly logger: Logger;

  constructor() {
    super();

    this.logger = componentLogger('events_listener');

    this.worker = new Worker('listener', async (job: Job) => {
      this.logger.debug(`Received event: ${job.name}`, { data: job.data });

      this.emit(job.name as ListenerEventType, job.data);
    });
  }
}
