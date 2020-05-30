import {DEFAULT_MASTER_CONFIG, MasterConfig, validateMasterConfig} from "./index";
import {DEFAULT_STREAM_CONFIG} from "./stream";

describe('Master :: Config', () => {
  test('Validates ok', async () => {
    await expect(validateMasterConfig({
      env: 'test',
      slaveAuth: {
        password: 'test'
      }
    } as Partial<MasterConfig>)).toEqual({
      ...DEFAULT_MASTER_CONFIG,
      env: 'test',
      slaveAuth: {
        password: 'test'
      }
    });

    await expect(validateMasterConfig({
      env: 'test',
      slaveAuth: {
        password: 'test'
      },
      log: {
        level: "debug",
        transports: {
          json: {
            enabled: true,
            file: 'log.txt',
          },
        }
      },
      defaultStreamConfig: {
        chunkDuration: 10,
        rewindBuffer: {
          maxSeconds: 600,
        },
        listen: {
          maxBufferSize: 1024,
        },
        eventsReport: {
          listener: {
            enabled: false,
          }
        },
      }
    } as Partial<MasterConfig>)).toEqual({
      ...DEFAULT_MASTER_CONFIG,
      env: 'test',
      slaveAuth: {
        password: 'test'
      },
      log: {
        level: "debug",
        transports: {
          json: {
            enabled: true,
            file: 'log.txt',
          },
          stackdriver: {
            enabled: false,
          },
        }
      },
      defaultStreamConfig: {
        enabled: true,
        chunkDuration: 10,
        rewindBuffer: {
          maxSeconds: 600,
        },
        listen: {
          initialBurstSeconds: DEFAULT_STREAM_CONFIG.listen!.initialBurstSeconds,
          maxBufferSize: 1024,
        },
        eventsReport: {
          listener: {
            enabled: false,
            interval: DEFAULT_STREAM_CONFIG.eventsReport!.listener.interval,
          }
        },
        ads: {
          enabled: false,
        }
      }
    });

  });
})
