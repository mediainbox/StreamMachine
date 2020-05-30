import {TypedEmitter} from "../helpers/events";
import {
  ListenerDisconnectEventData,
  ListenerEventType,
  ListenerEvents,
  ListenerListenEventData,
  ListenerStartEventData
} from "../events/listener";
import {IStore} from "./store/IStore";
import {Logger} from "winston";
import {componentLogger} from "../logger";
import {DateTimeStr, Kbytes, Seconds, Timestamp} from "../types/util";
import {toTime} from "../helpers/datetime";

export class EventsProcessor {
  private readonly logger: Logger;

  constructor(
    private readonly events: TypedEmitter<ListenerEvents>,
    private readonly store: IStore,
  ) {
    this.logger = componentLogger('events_processor');

    this.hookEvents();
  }

  hookEvents() {
    this.events.on(ListenerEventType.LISTENER_START, this.handleListenerStart);
    this.events.on(ListenerEventType.LISTENER_LISTEN, this.handleListenerListen);
    this.events.on(ListenerEventType.LISTENER_DISCONNECT, this.handleListenerDisconnect);
  }

  handleListenerStart = async (data: ListenerStartEventData) => {
    this.logger.debug(`Handle #${data.sessionId} start at ${toTime(data.datetime)}`, {
      data
    });

    try {
      await this.store.createSession({
        start: data.datetime,
        end: data.datetime,
        sessionId: data.sessionId,
        groupId: data.groupId,
        streamId: data.streamId,
        duration: 0 as Seconds,
        kbytes: 0 as Kbytes,
        outputType: data.outputType,
        finished: false,
        client: data.client,
        listenerId: data.listenerId,
        _createdAt: (new Date()).toISOString() as DateTimeStr,
        _updatedAt: (new Date()).toISOString() as DateTimeStr,
      });

      this.logger.debug(`Sucess handle #${data.sessionId} start at ${toTime(data.datetime)}`, {
        data
      });
    } catch (error) {
      this.logger.error(`Failed to handle #${data.sessionId} start at ${toTime(data.datetime)}`, {
        data,
        error,
        // error.meta.body.error
      });
    }
  };

  handleListenerListen = async (data: ListenerListenEventData) => {
    this.logger.debug(`Handle #${data.sessionId} listen at ${toTime(data.datetime)}`, {
      data
    });

    try {
      await this.createListen(data);

      await this.store.updateSession({
        sessionId: data.sessionId,
        duration: data.session.duration,
        kbytes: data.session.kbytes,
        end: data.datetime,
        finished: true,
        _updatedAt: (new Date()).toISOString() as DateTimeStr
      });

      this.logger.debug(`Sucess handle #${data.sessionId} listen at ${toTime(data.datetime)}`, {
        data
      });
    } catch (error) {
      this.logger.error(`Failed to handle #${data.sessionId} listen at ${toTime(data.datetime)}`, {
        data,
        error,
      });
    }
  };

  handleListenerDisconnect = async (data: ListenerDisconnectEventData) => {
    this.logger.debug(`Handle #${data.sessionId} disconnect`, {
      data
    });

    try {
      const { lastListen, session, ...rest } = data;
      await this.createListen({
        ...data,
        ...lastListen,
      });

      await this.store.updateSession({
        sessionId: data.sessionId,
        duration: data.session.duration,
        kbytes: data.session.kbytes,
        end: data.datetime,
        _updatedAt: (new Date()).toISOString() as DateTimeStr
      });

      this.logger.debug(`Sucess handle #${data.sessionId} disconnect at ${toTime(data.datetime)}`, {
        data
      });
    } catch (error) {
      this.logger.error(`Failed to handle #${data.sessionId} listen at ${toTime(data.datetime)}`, {
        data,
        error,
      });
    }
  };

  private createListen(data: ListenerListenEventData): Promise<void> {
    return this.store.createListen({
      datetime: data.datetime,
      sessionId: data.sessionId,
      groupId: data.groupId,
      streamId: data.streamId,
      duration: data.duration,
      kbytes: data.kbytes,
      listenerId: data.listenerId,
      outputType: data.outputType,
      client: data.client,
      session: {
        duration: data.session.duration,
        kbytes: data.session.kbytes,
        start: data.session.start,
      },
      _createdAt: (new Date()).toISOString() as DateTimeStr,
      _updatedAt: (new Date()).toISOString() as DateTimeStr
    });
  }
}
