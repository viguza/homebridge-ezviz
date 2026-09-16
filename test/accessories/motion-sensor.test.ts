import type { EZVIZAPI } from '../../src/api/ezviz-api';
import type { EZVIZPlatform } from '../../src/platform';
import { MotionSensor } from '../../src/accessories/motion-sensor';
import { FakeAccessory, makeFakePlatform } from '../test-utils/fake-hap';

/**
 * MotionSensor polls the EZVIZ alarm history and triggers on a changed timestamp, with
 * MQTT able to trigger it immediately regardless of poll timing. Both paths share a single
 * auto-clear timer. These tests drive poll()/onMqttAlarm() and the timers directly.
 */
function buildHarness(getLastAlarmTime = jest.fn().mockResolvedValue(null)) {
  const platform = makeFakePlatform();
  const accessory = new FakeAccessory('Front Door Motion');
  accessory.context.serial = 'CAM001';
  const api = { getLastAlarmTime } as unknown as EZVIZAPI;

  return { platform, accessory, api, getLastAlarmTime };
}

describe('MotionSensor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('the first poll only establishes a baseline and does not trigger motion', async () => {
    const { platform, accessory, api } = buildHarness(jest.fn().mockResolvedValue(1000));
    const sensor = new MotionSensor(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.MotionSensor)!;
    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(false);
    expect(service.updates).toHaveLength(0);

    sensor.stopPolling();
  });

  test('a changed alarm timestamp on a later poll triggers motion', async () => {
    const getLastAlarmTime = jest.fn().mockResolvedValueOnce(1000).mockResolvedValueOnce(2000);
    const { platform, accessory, api } = buildHarness(getLastAlarmTime);
    const sensor = new MotionSensor(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.MotionSensor)!;
    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(true);
    expect(service.updates).toContainEqual(['MotionDetected', true]);

    sensor.stopPolling();
  });

  test('motion auto-clears after the motion window elapses', async () => {
    const { platform, accessory, api } = buildHarness();
    const sensor = new MotionSensor(api, platform as unknown as EZVIZPlatform, accessory as never);
    sensor.onMqttAlarm();

    const service = accessory.getService(platform.Service.MotionSensor)!;
    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(true);

    jest.advanceTimersByTime(60_000);

    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(false);
    expect(service.updates).toContainEqual(['MotionDetected', false]);

    sensor.stopPolling();
  });

  test('onMqttAlarm triggers immediately and logs the MQTT source', () => {
    const { platform, accessory, api } = buildHarness();
    const sensor = new MotionSensor(api, platform as unknown as EZVIZPlatform, accessory as never);

    sensor.onMqttAlarm();

    expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining('motion detected (MQTT)'));
    sensor.stopPolling();
  });

  test('retriggering while already active resets the clear timer without a duplicate update', () => {
    const { platform, accessory, api } = buildHarness();
    const sensor = new MotionSensor(api, platform as unknown as EZVIZPlatform, accessory as never);
    const service = accessory.getService(platform.Service.MotionSensor)!;

    sensor.onMqttAlarm();
    expect(service.updates.filter(([, value]) => value === true)).toHaveLength(1);

    jest.advanceTimersByTime(45_000);
    sensor.onMqttAlarm(); // resets the 60s window from here instead of the first trigger
    expect(service.updates.filter(([, value]) => value === true)).toHaveLength(1); // no duplicate "true" push

    jest.advanceTimersByTime(45_000); // 90s since the first trigger, but only 45s since the reset
    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(true);

    sensor.stopPolling();
  });

  test('a poll failure is logged, not thrown', async () => {
    const { platform, accessory, api } = buildHarness(jest.fn().mockRejectedValue(new Error('network down')));
    const sensor = new MotionSensor(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('motion poll failed'),
      expect.any(Error),
    );

    sensor.stopPolling();
  });

  test('stopPolling stops further polling', async () => {
    const { getLastAlarmTime, platform, accessory, api } = buildHarness();
    const sensor = new MotionSensor(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();
    expect(getLastAlarmTime).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(getLastAlarmTime).toHaveBeenCalledTimes(2);

    sensor.stopPolling();
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(getLastAlarmTime).toHaveBeenCalledTimes(2);
  });
});
