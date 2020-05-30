import { Queue } from 'bullmq';
import {
  ListenerDisconnectEventData,
  ListenerEventType,
  ListenerListenEventData,
  ListenerStartEventData
} from "../events/listener";
import {DateTimeStr, Kbytes, Seconds, Timestamp} from "../types/util";
import {sleep} from "../helpers/promises";
import {GlobalQueues} from "../events";

const myQueue = new Queue(GlobalQueues.LISTENER);

async function addJobs() {
  function date(offset: number): DateTimeStr {
    return new Date(Date.now() - offset).toISOString() as DateTimeStr;
  }

  const startData: ListenerStartEventData = {
    datetime: date(10 * 60000),
    groupId: "client-1",
    listenerId: "listener-1",
    outputType: "raw",
    sessionId: "session-1",
    streamId: "stream-1",
    client: {
      ip: '100.0.0.1',
      path: '/stream-1',
      ua: 'Chrome',
      device: {
        type: '',
        os: '',
        browser: '',
      },
    }
  };
  console.log('Simulate LISTENER_START', {
    data: startData
  })
  await myQueue.add(ListenerEventType.LISTENER_START, startData);

  await sleep(1200);
  const listenData: ListenerListenEventData = {
    datetime: date(10 * 30000),
    groupId: "client-1",
    listenerId: "listener-1",
    outputType: "raw",
    sessionId: "session-1",
    streamId: "stream-1",
    client: {
      ip: '100.0.0.1',
      path: '/stream-1',
      ua: 'Chrome',
      device: {
        type: '',
        os: '',
        browser: '',
      },
    },
    session: {
      start: date(10 * 60000),
      duration: 300 as Seconds,
      kbytes: 30000 as Kbytes,
    },
    duration: 30 as Seconds,
    kbytes: 100 as Kbytes,
  };
  console.log('Simulate LISTENER_LISTEN', {
    data: listenData
  })
  await myQueue.add(ListenerEventType.LISTENER_LISTEN, listenData);
  console.log('listen added')

  await sleep(1200);
  const disconnectData: ListenerDisconnectEventData = {
    datetime: date(0),
    groupId: "client-1",
    listenerId: "listener-1",
    outputType: "raw",
    sessionId: "session-1",
    streamId: "stream-1",
    client: {
      ip: '100.0.0.1',
      path: '/stream-1',
      ua: 'Chrome',
      device: {
        type: '',
        os: '',
        browser: '',
      },
    },
    session: {
      start: date(10 * 60000),
      duration: 300 as Seconds,
      kbytes: 30000 as Kbytes,
    },
    lastListen: {
      duration: 30 as Seconds,
      kbytes: 100 as Kbytes,
    }
  };
  console.log('Simulate LISTENER_LISTEN', {
    data: disconnectData
  })
  await myQueue.add(ListenerEventType.LISTENER_DISCONNECT, disconnectData);
}

addJobs()
  .catch(console.error)
  .finally(() => myQueue.close());
