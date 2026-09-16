// The camera accessory pulls in the streaming delegate, which depends on the
// ESM-only `get-port`. Stubbing it keeps this suite from needing it.
jest.mock('../../src/accessories/ip-camera', () => ({ IPCamera: class {} }));
jest.mock('../../src/utils/mqtt-client', () => ({ EzvizMqttClient: class {} }));

import type { API, Logging } from 'homebridge';
import { EZVIZPlatform } from '../../src/platform';
import { EZVIZConfig, CameraConfig } from '../../src/types/config';

function buildPlatform(): EZVIZPlatform {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logging;
  const api = {
    hap: { Service: {}, Characteristic: {} },
    on: jest.fn(),
  } as unknown as API;
  const config = { name: 'EZVIZ' } as unknown as EZVIZConfig;

  return new EZVIZPlatform(log, config, api);
}

describe('cameraConfigErrors', () => {
  const platform = buildPlatform();

  test('returns an error when username is missing', () => {
    const camera = { code: 'verify-code' } as CameraConfig;
    expect(platform.cameraConfigErrors(camera)).toBe('No Username');
  });

  test('returns an error when the verification code is missing', () => {
    const camera = { username: 'user' } as CameraConfig;
    expect(platform.cameraConfigErrors(camera)).toBe('No Verification Code');
  });

  test('returns no error when both username and code are present', () => {
    const camera = { username: 'user', code: 'verify-code' } as CameraConfig;
    expect(platform.cameraConfigErrors(camera)).toBe('');
  });

  test('username is checked before the verification code', () => {
    const camera = {} as CameraConfig;
    expect(platform.cameraConfigErrors(camera)).toBe('No Username');
  });
});
