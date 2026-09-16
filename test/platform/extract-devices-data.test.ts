// The camera accessory pulls in the streaming delegate, which depends on the
// ESM-only `get-port`. Stubbing it keeps this suite from needing it.
jest.mock('../../src/accessories/ip-camera', () => ({ IPCamera: class {} }));
jest.mock('../../src/utils/mqtt-client', () => ({ EzvizMqttClient: class {} }));

import type { API, Logging } from 'homebridge';
import { EZVIZPlatform } from '../../src/platform';
import { EZVIZConfig } from '../../src/types/config';
import { ListDevicesResponse } from '../../src/types/devices';
import { DeviceTypes } from '../../src/utils/enums';

/**
 * extractDevicesData decides, per discovered device, whether it's supported, whether
 * it has a matching (and valid) config entry, and whether it needs splitting into two
 * accessories for a dual-lens camera. These tests pin each of those branches down —
 * previously only exercised indirectly by the dual-camera case in the motion sensor
 * routing suite.
 */
function buildPlatform(config: Partial<EZVIZConfig> = {}) {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logging;
  const api = {
    hap: {
      Service: {},
      Characteristic: {},
      uuid: { generate: (input: string) => `uuid(${input})` },
    },
    on: jest.fn(),
  } as unknown as API;

  const fullConfig = { name: 'EZVIZ', ...config } as unknown as EZVIZConfig;
  return { platform: new EZVIZPlatform(log, fullConfig, api), log };
}

function deviceListResponse(deviceInfos: Array<Record<string, unknown>>): ListDevicesResponse {
  return {
    deviceInfos,
    CONNECTION: {},
    WIFI: {},
    STATUS: {},
    SWITCH: {},
    P2P: {},
    resourceInfos: [],
  } as unknown as ListDevicesResponse;
}

describe('extractDevicesData', () => {
  test('skips a device with an unsupported category and logs it', () => {
    const { platform, log } = buildPlatform();
    const devices = platform.extractDevicesData(deviceListResponse([
      { deviceSerial: 'X1', name: 'Mystery Device', deviceCategory: 'NotARealType' },
    ]));

    expect(devices).toHaveLength(0);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Mystery Device has an unsupported type NotARealType and will be skipped'),
    );
  });

  test('skips a camera with no matching config entry and logs it', () => {
    const { platform, log } = buildPlatform({ cameras: [] });
    const devices = platform.extractDevicesData(deviceListResponse([
      { deviceSerial: 'CAM003', name: 'Backyard', deviceCategory: 'IPC' },
    ]));

    expect(devices).toHaveLength(0);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Camera Backyard (CAM003) is not configured and will be skipped'),
    );
  });

  test('skips a camera whose config entry fails validation and logs why', () => {
    const { platform, log } = buildPlatform({
      cameras: [{ serial: 'CAM_BAD', username: '', code: 'c' }],
    });
    const devices = platform.extractDevicesData(deviceListResponse([
      { deviceSerial: 'CAM_BAD', name: 'Garage', deviceCategory: 'IPC' },
    ]));

    expect(devices).toHaveLength(0);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('Device Garage (CAM_BAD) is not configured correctly and will be skipped: No Username'),
    );
  });

  test('includes a single-lens camera with a valid config entry', () => {
    const { platform } = buildPlatform({
      cameras: [{ serial: 'CAM001', username: 'u', code: 'c' }],
    });
    const devices = platform.extractDevicesData(deviceListResponse([
      { deviceSerial: 'CAM001', name: 'Front Door', deviceCategory: 'IPC' },
    ]));

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      Serial: 'CAM001',
      Name: 'Front Door',
      Type: DeviceTypes.IPC,
      HBConfig: { serial: 'CAM001', username: 'u', code: 'c' },
    });
  });

  test('splits a dual-camera device into two channel-suffixed accessories', () => {
    const { platform } = buildPlatform({
      cameras: [{ serial: 'CAM002', username: 'u', code: 'c', dualCamera: true }],
    });
    const devices = platform.extractDevicesData(deviceListResponse([
      { deviceSerial: 'CAM002', name: 'Driveway', deviceCategory: 'IPC' },
    ])) as unknown as Array<{
      UUID: string; Serial: string; Name: string; DeviceInfo: { channelNumber: number };
    }>;

    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({ UUID: 'uuid(CAM002_1)', Serial: 'CAM002_1', Name: 'Driveway - Camera 1' });
    expect(devices[0].DeviceInfo.channelNumber).toBe(101);
    expect(devices[1]).toMatchObject({ UUID: 'uuid(CAM002_2)', Serial: 'CAM002_2', Name: 'Driveway - Camera 2' });
    expect(devices[1].DeviceInfo.channelNumber).toBe(201);
  });

  test('includes a plug with a matching config entry', () => {
    const { platform } = buildPlatform({
      plugs: [{ serial: 'PLUG001', code: 'c' }],
    });
    const devices = platform.extractDevicesData(deviceListResponse([
      { deviceSerial: 'PLUG001', name: 'Lamp', deviceCategory: 'Socket' },
    ]));

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      Serial: 'PLUG001',
      Type: DeviceTypes.Socket,
      HBConfig: { serial: 'PLUG001', code: 'c' },
    });
  });

  test('includes a plug with no matching config entry, unlike an unconfigured camera', () => {
    const { platform } = buildPlatform({ plugs: [] });
    const devices = platform.extractDevicesData(deviceListResponse([
      { deviceSerial: 'PLUG002', name: 'Fan', deviceCategory: 'Socket' },
    ]));

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ Serial: 'PLUG002', HBConfig: undefined });
  });
});
