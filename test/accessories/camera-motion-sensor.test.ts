import type { EZVIZAPI } from '../../src/api/ezviz-api';
import type { EZVIZPlatform } from '../../src/platform';
import { CameraMotionSensor } from '../../src/accessories/camera-motion-sensor';
import { makeFakeService, makeFakePlatform } from '../test-utils/fake-hap';

/**
 * CameraMotionSensor polls the EZVIZ alarm history and triggers on a changed timestamp, with
 * MQTT able to trigger it immediately regardless of poll timing. Both paths share a single
 * auto-clear timer. These tests drive poll()/onMqttAlarm() and the timers directly.
 *
 * CameraMotionSensor no longer owns an accessory — it drives a Service handed to it by IPCamera
 * (which links it to the camera's primary service; see IPCamera.getMotionService), so
 * the harness passes a bare fake Service plus the serial/display name IPCamera would.
 */
function buildHarness(getLatestAlarm = jest.fn().mockResolvedValue(null)) {
  const platform = makeFakePlatform();
  const service = makeFakeService('Motion');
  const api = { getLatestAlarm } as unknown as EZVIZAPI;

  return { platform, service, api, getLatestAlarm };
}

describe('CameraMotionSensor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('the first poll only establishes a baseline and does not trigger motion', async () => {
    const { platform, service, api } = buildHarness(jest.fn().mockResolvedValue({ time: 1000, picUrl: '' }));
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');
    await Promise.resolve();

    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(false);
    expect(service.updates).toHaveLength(0);

    sensor.stopPolling();
  });

  test('a changed alarm timestamp on a later poll triggers motion', async () => {
    const getLatestAlarm = jest.fn()
      .mockResolvedValueOnce({ time: 1000, picUrl: '' })
      .mockResolvedValueOnce({ time: 2000, picUrl: 'https://example.com/pic.jpg' });
    const { platform, service, api } = buildHarness(getLatestAlarm);
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');
    await Promise.resolve();

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(true);
    expect(service.updates).toContainEqual(['MotionDetected', true]);
    expect(platform.updateAlarmSnapshot).toHaveBeenCalledWith('CAM001', 'https://example.com/pic.jpg', 2000);

    sensor.stopPolling();
  });

  test('motion auto-clears after the motion window elapses', async () => {
    const { platform, service, api } = buildHarness();
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');
    sensor.onMqttAlarm();

    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(true);

    jest.advanceTimersByTime(60_000);

    expect(service.getCharacteristic(platform.Characteristic.MotionDetected).onGetHandler!()).toBe(false);
    expect(service.updates).toContainEqual(['MotionDetected', false]);

    sensor.stopPolling();
  });

  test('onMqttAlarm triggers immediately and logs the MQTT source', () => {
    const { platform, service, api } = buildHarness();
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');

    sensor.onMqttAlarm();

    expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining('motion detected (MQTT)'));
    sensor.stopPolling();
  });

  test('a poll-triggered event after a prior MQTT event logs the poll source, not a stale MQTT tag', async () => {
    const getLatestAlarm = jest.fn()
      .mockResolvedValueOnce({ time: 1000, picUrl: '' })
      .mockResolvedValueOnce({ time: 2000, picUrl: '' });
    const { platform, service, api } = buildHarness(getLatestAlarm);
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');
    await Promise.resolve();

    sensor.onMqttAlarm();
    expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining('motion detected (MQTT)'));

    jest.advanceTimersByTime(60_000); // let the MQTT-triggered motion clear before the next poll fires
    await Promise.resolve();

    jest.advanceTimersByTime(30_000); // poll picks up the changed alarm timestamp
    await Promise.resolve();

    expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining('motion detected (poll)'));
    const mqttLogCalls = platform.log.info.mock.calls.filter(
      ([message]: [string]) => message.includes('motion detected (MQTT)'),
    );
    expect(mqttLogCalls).toHaveLength(1); // only the earlier MQTT-triggered event, not this poll one

    sensor.stopPolling();
  });

  test('retriggering while already active resets the clear timer without a duplicate update', () => {
    const { platform, service, api } = buildHarness();
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');

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
    const { platform, service, api } = buildHarness(jest.fn().mockRejectedValue(new Error('network down')));
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');
    await Promise.resolve();

    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('motion poll failed'),
      expect.any(Error),
    );

    sensor.stopPolling();
  });

  test('stopPolling stops further polling', async () => {
    const { getLatestAlarm, platform, service, api } = buildHarness();
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');
    await Promise.resolve();
    expect(getLatestAlarm).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(getLatestAlarm).toHaveBeenCalledTimes(2);

    sensor.stopPolling();
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(getLatestAlarm).toHaveBeenCalledTimes(2);
  });
});

/**
 * MQTT can stay connected while EZVIZ stops pushing to it (#53). An alarm only the poll
 * saw is reported to the platform so it can reconnect MQTT.
 */
describe('CameraMotionSensor missed-MQTT detection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // First poll sets the baseline (1000), the next one at +30s sees `nextTime`.
  async function pollNewAlarm(nextTime = 2000, beforeSecondPoll?: (sensor: CameraMotionSensor) => void) {
    const getLatestAlarm = jest.fn()
      .mockResolvedValueOnce({ time: 1000, picUrl: '' })
      .mockResolvedValue({ time: nextTime, picUrl: '' });
    const { platform, service, api } = buildHarness(getLatestAlarm);
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');
    await Promise.resolve();
    beforeSecondPoll?.(sensor);
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    return { platform, sensor };
  }

  test('reports an alarm MQTT never pushed, after a short grace period', async () => {
    const { platform, sensor } = await pollNewAlarm();

    expect(platform.handleMissedMqttAlarm).not.toHaveBeenCalled();
    jest.advanceTimersByTime(15_000);
    expect(platform.handleMissedMqttAlarm).toHaveBeenCalledWith('Front Door');

    sensor.stopPolling();
  });

  test('does not report an alarm MQTT already pushed', async () => {
    const { platform, sensor } = await pollNewAlarm(2000, (s) => s.onMqttAlarm());

    jest.advanceTimersByTime(15_000);
    expect(platform.handleMissedMqttAlarm).not.toHaveBeenCalled();

    sensor.stopPolling();
  });

  test('does not report an alarm whose push arrives just after the poll', async () => {
    const { platform, sensor } = await pollNewAlarm();

    jest.advanceTimersByTime(5_000);
    sensor.onMqttAlarm();
    jest.advanceTimersByTime(10_000);
    expect(platform.handleMissedMqttAlarm).not.toHaveBeenCalled();

    sensor.stopPolling();
  });

  test('does not report when the latest alarm moved back to an older one', async () => {
    const { platform, sensor } = await pollNewAlarm(500);

    jest.advanceTimersByTime(15_000);
    expect(platform.handleMissedMqttAlarm).not.toHaveBeenCalled();

    sensor.stopPolling();
  });

  test('stopPolling cancels a pending check', async () => {
    const { platform, sensor } = await pollNewAlarm();

    sensor.stopPolling();
    jest.advanceTimersByTime(15_000);
    expect(platform.handleMissedMqttAlarm).not.toHaveBeenCalled();
  });
});

describe('CameraMotionSensor poll interval', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('polls on the interval it was given', async () => {
    const { platform, service, api, getLatestAlarm } = buildHarness();
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door', 5);
    await Promise.resolve();
    expect(getLatestAlarm).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5_000);
    expect(getLatestAlarm).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(5_000);
    expect(getLatestAlarm).toHaveBeenCalledTimes(3);

    sensor.stopPolling();
  });

  test('defaults to polling every 30 seconds', async () => {
    const { platform, service, api, getLatestAlarm } = buildHarness();
    const sensor = new CameraMotionSensor(api, platform as unknown as EZVIZPlatform, service as never, 'CAM001', 'Front Door');
    await Promise.resolve();

    jest.advanceTimersByTime(29_000);
    expect(getLatestAlarm).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1_000);
    expect(getLatestAlarm).toHaveBeenCalledTimes(2);

    sensor.stopPolling();
  });
});
