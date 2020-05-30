import {logConfigSchema, LoggerConfig} from "./config";

describe('Logger :: Config', () => {
  test('Validates schema', async () => {
    await expect(logConfigSchema.validateSync({
      level: 'debug',
      transports: {
        json: {
          enabled: true,
          level: 'info',
          file: 'log.txt'
        },
        stackdriver: {
          enabled: true,
          level: 'silly',
          serviceContext: {
            service: 'my-service',
            version: '1.0.0'
          }
        }
      }
    } as LoggerConfig)).toBeTruthy();

    await expect(logConfigSchema.validateSync({
      level: 'debug',
      transports: {
        json: {
          enabled: true,
          file: 'log.txt'
        },
        stackdriver: {
          enabled: true,
        }
      }
    } as LoggerConfig)).toBeTruthy();

    await expect(logConfigSchema.validateSync({
      level: 'debug',
      transports: {
        json: {
          enabled: false,
        },
        stackdriver: {
          enabled: false,
        }
      }
    } as LoggerConfig)).toBeTruthy();

    await expect(() => logConfigSchema.validateSync({})).toThrow();

    await expect(() => logConfigSchema.validateSync({
      level: 'wrong',
      transports: {}
    })).toThrow();

    await expect(() => logConfigSchema.validateSync({
      level: 'debug',
      transports: {
        json: {
          enabled: true,
        },
        stackdriver: {
          enabled: true,
        }
      }
    })).toThrow();
  });
})
