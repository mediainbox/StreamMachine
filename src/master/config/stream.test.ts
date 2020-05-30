import {DEFAULT_STREAM_CONFIG, MasterStreamConfig, validateStreamConfig} from "./stream";
import {Kbytes, Seconds} from "../../types/util";

describe('Master :: Config :: Stream', () => {
  test('Validates ok', async () => {
    await expect(validateStreamConfig({
      id: 'stream-1',
      clientId: 'client-1',
    } as MasterStreamConfig)).toEqual({
      enabled: true,
      id: 'stream-1',
      clientId: 'client-1',
      chunkDuration: DEFAULT_STREAM_CONFIG.chunkDuration!,
      rewindBuffer: DEFAULT_STREAM_CONFIG.rewindBuffer,
      listen: DEFAULT_STREAM_CONFIG.listen,
      eventsReport: {
        listener: DEFAULT_STREAM_CONFIG.eventsReport!.listener
      },
      ads: {
        enabled: false,
      },
    });

    await expect(validateStreamConfig({
      enabled: false,
      id: 'stream-1',
      clientId: 'client-1',
      chunkDuration: 10 as Seconds,
      rewindBuffer: {
        maxSeconds: 600 as Seconds,
      },
      listen: {
        initialBurstSeconds: 2 as Seconds,
        maxBufferSize: 4096 as Kbytes,
      },
      eventsReport: {
        listener: {
          enabled: true,
          interval: 15 as Seconds,
        }
      },
      ads: {
        enabled: true,
        serverUrl: 'http://server.com',
        transcoderUrl: 'http://transcoder.com',
        adTimeoutMs: 5000,
        impressionDelayMs: 5000,
        prerollKey: '',
      },
    } as MasterStreamConfig)).toBeTruthy();

    await expect(() => validateStreamConfig({
      clientId: 'client-1',
    } as MasterStreamConfig)).toThrow();

    await expect(() => validateStreamConfig({
      id: 'client-1',
    } as MasterStreamConfig)).toThrow();

    await expect(() => validateStreamConfig({
      id: 'client-1',
      clientId: 'client-1',
      ads: {
        enabled: true,
        transcoderUrl: 'http://transcoder.com',
        adTimeoutMs: 5000,
        impressionDelayMs: 5000,
        prerollKey: '',
      },
    } as MasterStreamConfig)).toThrow();

    await expect(() => validateStreamConfig({
      id: 'client-1',
      clientId: 'client-1',
      ads: {
        enabled: true,
        serverUrl: 'http://server.com',
        transcoderUrl: 'wrong',
        adTimeoutMs: 5000,
        impressionDelayMs: 5000,
        prerollKey: '',
      },
    } as MasterStreamConfig)).toThrow();
  });
})
