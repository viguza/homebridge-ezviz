import type { EZVIZAPI } from '../../src/api/ezviz-api';
import type { EZVIZPlatform } from '../../src/platform';
import { DEFAULT_GROUP_ID } from '../../src/api/ezviz-constants';
import { SecuritySystemAccessory, defenceModeToState, targetStateToDefenceMode } from '../../src/accessories/security-system';
import { DefenceMode } from '../../src/utils/enums';
import { FakeAccessory, makeFakePlatform } from '../test-utils/fake-hap';

/**
 * These two pure mapping functions are the entire contract between HomeKit's
 * SecuritySystem states and EZVIZ's defence modes. A previous version of
 * targetStateToDefenceMode sent UNSET_MODE for DISARM, which does not actually
 * disarm the device on real hardware (EZVIZ reports it as "Armado", same as
 * Away/Night) — these tests pin the corrected mapping down.
 */
describe('defenceModeToState', () => {
  test('HOME_MODE maps to STAY_ARM (0)', () => {
    expect(defenceModeToState(DefenceMode.HOME_MODE)).toBe(0);
  });

  test('AWAY_MODE maps to AWAY_ARM (1)', () => {
    expect(defenceModeToState(DefenceMode.AWAY_MODE)).toBe(1);
  });

  test('SLEEP_MODE maps to NIGHT_ARM (2)', () => {
    expect(defenceModeToState(DefenceMode.SLEEP_MODE)).toBe(2);
  });

  test('UNSET_MODE maps to DISARMED (3)', () => {
    expect(defenceModeToState(DefenceMode.UNSET_MODE)).toBe(3);
  });

  test('an unrecognized mode falls back to DISARMED (3)', () => {
    expect(defenceModeToState(99 as DefenceMode)).toBe(3);
  });
});

describe('targetStateToDefenceMode', () => {
  test('AWAY_ARM (1) maps to AWAY_MODE', () => {
    expect(targetStateToDefenceMode(1)).toBe(DefenceMode.AWAY_MODE);
  });

  test('NIGHT_ARM (2) maps to SLEEP_MODE', () => {
    expect(targetStateToDefenceMode(2)).toBe(DefenceMode.SLEEP_MODE);
  });

  test('STAY_ARM (0) maps to HOME_MODE, the only mode that actually disarms', () => {
    expect(targetStateToDefenceMode(0)).toBe(DefenceMode.HOME_MODE);
  });

  test('DISARM (3) maps to HOME_MODE, not UNSET_MODE', () => {
    expect(targetStateToDefenceMode(3)).toBe(DefenceMode.HOME_MODE);
  });

  test('an unrecognized state falls back to HOME_MODE', () => {
    expect(targetStateToDefenceMode(99)).toBe(DefenceMode.HOME_MODE);
  });
});

function buildHarness(getDefenceMode = jest.fn().mockResolvedValue(DefenceMode.UNSET_MODE)) {
  const platform = makeFakePlatform();
  const accessory = new FakeAccessory('Alarm Mode');
  const setDefenceMode = jest.fn().mockResolvedValue(undefined);
  const api = { getDefenceMode, setDefenceMode } as unknown as EZVIZAPI;

  return { platform, accessory, api, getDefenceMode, setDefenceMode };
}

describe('SecuritySystemAccessory', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('removes a stale Switch service left over from the old alarm-mode accessory', () => {
    const { platform, accessory, api } = buildHarness();
    accessory.addService(platform.Service.Switch);
    expect(accessory.getService(platform.Service.Switch)).toBeDefined();

    const alarm = new SecuritySystemAccessory(api, platform as unknown as EZVIZPlatform, accessory as never);

    expect(accessory.getService(platform.Service.Switch)).toBeUndefined();
    alarm.stopPolling();
  });

  test('the initial background refresh reflects the current defence mode', async () => {
    const { platform, accessory, api } = buildHarness(jest.fn().mockResolvedValue(DefenceMode.AWAY_MODE));
    const alarm = new SecuritySystemAccessory(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.SecuritySystem)!;
    expect(service.getCharacteristic(platform.Characteristic.SecuritySystemCurrentState).onGetHandler!()).toBe(1);
    expect(service.updates).toContainEqual(['SecuritySystemCurrentState', 1]);
    expect(service.updates).toContainEqual(['SecuritySystemTargetState', 1]);

    alarm.stopPolling();
  });

  test('getState throws SERVICE_COMMUNICATION_FAILURE when the last refresh failed', async () => {
    const { platform, accessory, api } = buildHarness(jest.fn().mockRejectedValue(new Error('offline')));
    const alarm = new SecuritySystemAccessory(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.SecuritySystem)!;
    expect(() => service.getCharacteristic(platform.Characteristic.SecuritySystemCurrentState).onGetHandler!())
      .toThrow('HapStatusError');

    alarm.stopPolling();
  });

  test('setting DISARM (Off) sends HOME_MODE, the only mode that actually disarms the device', async () => {
    const { platform, accessory, api, setDefenceMode } = buildHarness();
    const alarm = new SecuritySystemAccessory(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.SecuritySystem)!;
    const targetChar = service.getCharacteristic(platform.Characteristic.SecuritySystemTargetState);
    await targetChar.onSetHandler!(3);

    expect(setDefenceMode).toHaveBeenCalledWith(DEFAULT_GROUP_ID, DefenceMode.HOME_MODE);
    // HOME_MODE reads back as STAY_ARM (0) — EZVIZ has no distinct "off" mode of its own,
    // so Stay and Off both resolve to the same underlying disarmed state.
    expect(service.updates).toContainEqual(['SecuritySystemCurrentState', 0]);

    alarm.stopPolling();
  });

  test('setTargetState throws SERVICE_COMMUNICATION_FAILURE and logs when the API call fails', async () => {
    const { platform, accessory, api, setDefenceMode } = buildHarness();
    setDefenceMode.mockRejectedValueOnce(new Error('network down'));
    const alarm = new SecuritySystemAccessory(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.SecuritySystem)!;
    const targetChar = service.getCharacteristic(platform.Characteristic.SecuritySystemTargetState);
    await expect(targetChar.onSetHandler!(1)).rejects.toThrow('HapStatusError');
    expect(platform.log.error).toHaveBeenCalledWith('Unable to set alarm mode:', expect.any(Error));

    alarm.stopPolling();
  });

  test('stopPolling stops further background refreshes', async () => {
    const { platform, accessory, api, getDefenceMode } = buildHarness();
    const alarm = new SecuritySystemAccessory(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();
    expect(getDefenceMode).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(getDefenceMode).toHaveBeenCalledTimes(2);

    alarm.stopPolling();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(getDefenceMode).toHaveBeenCalledTimes(2);
  });
});
