// The camera accessory pulls in the streaming delegate, which depends on the
// ESM-only `get-port`. Stubbing it keeps this suite from needing it.
jest.mock('../../src/accessories/ip-camera', () => ({ IPCamera: class {} }));
jest.mock('../../src/utils/mqtt-client', () => ({ EzvizMqttClient: class {} }));

import type { API, Logging } from 'homebridge';
import { AxiosError } from 'axios';
import { EZVIZPlatform } from '../../src/platform';
import { EZVIZAPI } from '../../src/api/ezviz-api';
import { EZVIZConfig } from '../../src/types/config';
import { Credentials } from '../../src/types/login';

function buildPlatform(): EZVIZPlatform {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logging;
  const api = {
    hap: { Service: {}, Characteristic: {} },
    on: jest.fn(),
  } as unknown as API;
  const config = { name: 'EZVIZ', email: 'a@b.com', password: 'pw', region: 1 } as unknown as EZVIZConfig;

  return new EZVIZPlatform(log, config, api);
}

function networkError(): AxiosError {
  const error = new Error('getaddrinfo ENOTFOUND apiius.ezvizlife.com') as AxiosError;
  error.isAxiosError = true;
  return error;
}

describe('authenticateWithRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('retries through transient network failures until authentication succeeds', async () => {
    const platform = buildPlatform();
    const ezvizAPI = Object.create(EZVIZAPI.prototype) as EZVIZAPI;
    const credentials = { sessionId: 'abc' } as Credentials;

    ezvizAPI.getDomain = jest.fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce('https://test.ezviz.com');
    ezvizAPI.authenticate = jest.fn().mockResolvedValue(credentials);

    const resultPromise = platform.authenticateWithRetry(ezvizAPI);

    // Let each retry's backoff timer elapse; two failures precede the success.
    await jest.advanceTimersByTimeAsync(15000);
    await jest.advanceTimersByTimeAsync(30000);

    await expect(resultPromise).resolves.toBe(credentials);
    expect(ezvizAPI.getDomain).toHaveBeenCalledTimes(3);
  });

  test('does not retry on a non-network authentication failure', async () => {
    const platform = buildPlatform();
    const ezvizAPI = Object.create(EZVIZAPI.prototype) as EZVIZAPI;

    ezvizAPI.getDomain = jest.fn().mockResolvedValue('https://test.ezviz.com');
    ezvizAPI.authenticate = jest.fn().mockResolvedValue(undefined);

    const result = await platform.authenticateWithRetry(ezvizAPI);

    expect(result).toBeUndefined();
    expect(ezvizAPI.getDomain).toHaveBeenCalledTimes(1);
  });
});
