// The camera accessory pulls in the streaming delegate, which depends on the
// ESM-only `get-port`. Stubbing it keeps this suite to the platform's routing logic.
jest.mock('../../src/accessories/ip-camera', () => ({ IPCamera: class {} }));
jest.mock('../../src/utils/mqtt-client', () => ({ EzvizMqttClient: class {} }));

import type { API, Logging } from 'homebridge';
import { EZVIZPlatform } from '../../src/platform';
import { EZVIZAPI } from '../../src/api/ezviz-api';
import { EZVIZConfig } from '../../src/types/config';
import { ListDevicesResponse } from '../../src/types/devices';
import { CAMERA_DEVICE_TYPES, DeviceTypes } from '../../src/utils/enums';

/**
 * Motion events arrive keyed by the bare device serial, while a dual camera's
 * accessories carry a channel-suffixed serial. These tests pin the mapping between
 * the two so a suffixed serial can never again swallow every motion event.
 */

type Pushed = [string, string, unknown];

function buildHarness() {
  const pushed: Pushed[] = [];
  const registered: string[] = [];

  const makeService = (name: string) => ({
    setCharacteristic() {
      return this;
    },
    getCharacteristic() {
      return { onGet() {
        return this;
      } };
    },
    updateCharacteristic(characteristic: string, value: unknown) {
      pushed.push([name, characteristic, value]);
    },
  });

  class FakeAccessory {
    displayName: string;
    UUID: string;
    context: Record<string, unknown> = {};
    private info = makeService('info');
    private motion: ReturnType<typeof makeService> | null = null;

    constructor(name: string, uuid: string) {
      this.displayName = name;
      this.UUID = uuid;
    }

    getService(service: string) {
      return service === 'Info' ? this.info : this.motion;
    }

    addService() {
      this.motion = makeService(this.displayName);
      return this.motion;
    }
  }

  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logging;

  const api = {
    hap: {
      Service: { AccessoryInformation: 'Info', MotionSensor: 'Motion' },
      Characteristic: { Manufacturer: 'M', Model: 'Mo', SerialNumber: 'S', Name: 'N', MotionDetected: 'MotionDetected' },
      uuid: { generate: (input: string) => `uuid(${input})` },
    },
    on: jest.fn(),
    registerPlatformAccessories: (_p: string, _n: string, [accessory]: FakeAccessory[]) => {
      registered.push(accessory.displayName);
    },
    platformAccessory: FakeAccessory,
  } as unknown as API;

  const config = {
    name: 'EZVIZ',
    cameras: [
      { serial: 'DUAL001', username: 'u', code: 'c', dualCamera: true, motionSensor: true },
      { serial: 'BATT001', username: 'u', code: 'c', motionSensor: true },
    ],
  } as unknown as EZVIZConfig;

  return { platform: new EZVIZPlatform(log, config, api), pushed, registered };
}

const deviceListResponse = {
  deviceInfos: [
    { deviceSerial: 'DUAL001', name: 'Front Door', deviceCategory: 'IPC', deviceSubCategory: 'x' },
    { deviceSerial: 'BATT001', name: 'Driveway', deviceCategory: 'BatteryCamera', deviceSubCategory: 'x' },
  ],
  CONNECTION: { DUAL001: {}, BATT001: {} },
  WIFI: {},
  STATUS: { DUAL001: {}, BATT001: {} },
  SWITCH: { DUAL001: [], BATT001: [] },
  P2P: { DUAL001: [], BATT001: [] },
  resourceInfos: [],
} as unknown as ListDevicesResponse;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createSensors(platform: any) {
  const ezvizApi = { getLastAlarmTime: jest.fn().mockResolvedValue(null) } as unknown as EZVIZAPI;
  const devices = platform.extractDevicesData(deviceListResponse);
  for (const device of devices) {
    if (CAMERA_DEVICE_TYPES.has(device.Type as DeviceTypes) && device.HBConfig?.motionSensor) {
      platform.createMotionSensor(ezvizApi, device);
    }
  }
  return devices;
}

describe('motion sensor event routing', () => {
  // MotionSensor schedules a poll interval and a motion auto-clear timeout; fake
  // timers keep those from holding the test process open.
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('dual camera accessories keep a channel-suffixed serial', () => {
    const { platform } = buildHarness();
    const devices = createSensors(platform);

    expect(devices.map((d: { Serial: string }) => d.Serial)).toEqual(['DUAL001_1', 'DUAL001_2', 'BATT001']);
  });

  test('sensors are keyed on the bare device serial that events carry', () => {
    const { platform } = buildHarness();
    createSensors(platform);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sensors = (platform as any).motionSensors;
    expect([...sensors.keys()]).toEqual(['DUAL001', 'BATT001']);
    expect(sensors.get('DUAL001')).toHaveLength(2);
    expect(sensors.get('BATT001')).toHaveLength(1);
  });

  test('an MQTT alarm triggers every lens of a dual camera', () => {
    const { platform, pushed } = buildHarness();
    createSensors(platform);
    pushed.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (platform as any).handleMqttAlarm('DUAL001');

    expect(pushed).toEqual([
      ['Front Door - Camera 1 Motion', 'MotionDetected', true],
      ['Front Door - Camera 2 Motion', 'MotionDetected', true],
    ]);
  });

  test('battery cameras get a motion sensor and receive alarms', () => {
    const { platform, pushed, registered } = buildHarness();
    createSensors(platform);
    expect(registered).toContain('Driveway Motion');

    pushed.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (platform as any).handleMqttAlarm('BATT001');

    expect(pushed).toEqual([['Driveway Motion', 'MotionDetected', true]]);
  });

  test('polling uses the bare serial so alarm history can match it', () => {
    const { platform } = buildHarness();
    createSensors(platform);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serials = [...(platform as any).motionSensors.values()]
      .flat()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((sensor: any) => sensor.accessory.context.serial);
    expect(serials).toEqual(['DUAL001', 'DUAL001', 'BATT001']);
  });

  test('an alarm for an unknown serial is ignored without throwing', () => {
    const { platform, pushed } = buildHarness();
    createSensors(platform);
    pushed.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (platform as any).handleMqttAlarm('UNKNOWN')).not.toThrow();
    expect(pushed).toHaveLength(0);
  });
});
