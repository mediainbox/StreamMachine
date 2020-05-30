import {DEFAULT_SLAVE_CONFIG, SlaveConfig, validateSlaveConfig} from "./index";
import {DEFAULT_STREAM_CONFIG} from "../../master/config/stream";
import {MasterConfig, validateMasterConfig} from "../../master/config";
import {DeepPartial} from "ts-essentials";
import {Milliseconds} from "../../types/util";
import {IfEnabled} from "../../types";

describe('Slave :: Config', () => {
  test('Validates ok', async () => {
    await expect(validateSlaveConfig({
      env: 'test',
      slaveId: 'slave-1',
      master: {
        password: 'pass',
        urls: ['http://master.com']
      }
    } as DeepPartial<SlaveConfig>)).toEqual({
      ...DEFAULT_SLAVE_CONFIG,
      env: 'test',
      slaveId: 'slave-1',
      master: {
        password: 'pass',
        urls: ['http://master.com'],
        timeout: DEFAULT_SLAVE_CONFIG.master!.timeout
      }
    });

    await expect(validateSlaveConfig({
      env: 'test',
      slaveId: 'slave-1',
      master: {
        password: 'pass',
        urls: ['http://master.com'],
        timeout: 2000 as Milliseconds,
      },
      cluster: {
        enabled: true,
        workers: 4
      },
      server: {
        useGreenlock: true,
        httpPort: 8080,
        httpsPort: 8443,
        cors: {
          enabled: true,
          origin: 'http://website.com'
        }
      }
    } as DeepPartial<SlaveConfig>)).toEqual({
      ...DEFAULT_SLAVE_CONFIG,
      env: 'test',
      slaveId: 'slave-1',
      master: {
        password: 'pass',
        urls: ['http://master.com'],
        timeout: 2000,
      },
      cluster: {
        enabled: true,
        workers: 4
      },
      server: {
        ...DEFAULT_SLAVE_CONFIG.server,
        useGreenlock: true,
        httpPort: 8080,
        httpsPort: 8443,
        cors: {
          enabled: true,
          origin: 'http://website.com'
        }
      }
    });
  });
})
