import {MasterConnection} from "../master_io/MasterConnection";
import {SlaveEvent, slaveEvents} from "../events";
import {SlaveListenerDisconnectEvent, SlaveListenerListenEvent, SlaveListenerListenStartEvent} from "./types";
import {Queue} from "bullmq";
import {GlobalQueues} from "../../events";
import {
  ListenerDisconnectEventData,
  ListenerEventType,
  ListenerListenEventData,
  ListenerStartEventData
} from "../../events/listener";
import {Kbytes} from "../../types/util";
import {componentLogger} from "../../logger";
import {Logger} from "winston";
import {SlaveConfig} from "../config";

export class EventsReporter {
  private readonly listenerQueue: Queue;
  private readonly logger: Logger;

  constructor(
    private readonly masterConnection: MasterConnection,
    private readonly config: SlaveConfig,
  ) {
    this.listenerQueue = new Queue(GlobalQueues.LISTENER);
    this.logger = componentLogger('events_reporter');

    this.hookEvents();
  }

  // serialize events to go through ws
  private hookEvents() {
    slaveEvents().on(SlaveEvent.LISTENER_START, (data: SlaveListenerListenStartEvent) => {
      this.logger.debug(`Report event ${ListenerEventType.LISTENER_START}`);

      const jobData: ListenerStartEventData = {
        datetime: data.datetime,
        groupId: data.stream.getClientId(),
        streamId: data.stream.getId(),
        listenerId: data.listener.getId(),
        sessionId: data.listener.getSessionId(),
        outputType: data.output.getType(),
        client: data.listener.getClient()
      };

      this.listenerQueue.add(ListenerEventType.LISTENER_START, jobData);
    });

    slaveEvents().on(SlaveEvent.LISTENER_LISTEN, (data: SlaveListenerListenEvent) => {
      this.logger.debug(`Report event ${ListenerEventType.LISTENER_LISTEN}`);

      const jobData: ListenerListenEventData = {
        datetime: data.datetime,
        groupId: data.stream.getClientId(),
        streamId: data.stream.getId(),
        listenerId: data.listener.getId(),
        sessionId: data.listener.getSessionId(),
        outputType: data.output.getType(),
        client: data.listener.getClient(),
        duration: data.duration,
        kbytes: data.kbytes,
        session: {
          start: data.startedAt,
          duration: data.session.duration,
          kbytes: data.session.kbytes,
        },
      };
      this.listenerQueue.add(SlaveEvent.LISTENER_LISTEN, jobData);
    });

    slaveEvents().on(SlaveEvent.LISTENER_DISCONNECT, (data: SlaveListenerDisconnectEvent) => {
      this.logger.debug(`Report event ${ListenerEventType.LISTENER_DISCONNECT}`);

      const jobData: ListenerDisconnectEventData = {
        datetime: data.datetime,
        groupId: data.stream.getClientId(),
        streamId: data.stream.getId(),
        listenerId: data.listener.getId(),
        sessionId: data.listener.getSessionId(),
        outputType: data.output.getType(),
        client: data.listener.getClient(),
        session: {
          start: data.startedAt,
          duration: data.session.duration,
          kbytes: data.session.kbytes,
        },
        lastListen: data.lastListen
      };
      this.listenerQueue.add(SlaveEvent.LISTENER_DISCONNECT, jobData);
    });
  }
}
