import type { EZVIZAPI } from '../../src/api/ezviz-api';
import type { EZVIZPlatform } from '../../src/platform';
import { SmartPlug } from '../../src/accessories/smart-plug';
import { SwitchTypes } from '../../src/utils/enums';
import { FakeAccessory, makeFakePlatform } from '../test-utils/fake-hap';

/**
 * SmartPlug answers HomeKit reads from cached state (refreshed in the background) rather
 * than blocking on the network, and reports "No Response" instead of a stale value when a
 * refresh fails. These tests drive its onSet/onGet handlers and refresh timer directly.
 */
function buildHarness(getSwitchState = jest.fn().mockResolvedValue(false)) {
  const platform = makeFakePlatform();
  const accessory = new FakeAccessory('Lamp');
  accessory.context.device = {
    Serial: 'PLUG001',
    Name: 'Lamp',
    DeviceInfo: { deviceSubCategory: 'Plug' },
  };
  const setSwitchState = jest.fn().mockResolvedValue(undefined);
  const api = { getSwitchState, setSwitchState } as unknown as EZVIZAPI;

  return { platform, accessory, api, getSwitchState, setSwitchState };
}

describe('SmartPlug', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('the initial background refresh populates cached state and pushes it to HomeKit', async () => {
    const { platform, accessory, api } = buildHarness(jest.fn().mockResolvedValue(true));
    const plug = new SmartPlug(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.Switch)!;
    expect(service.getCharacteristic(platform.Characteristic.On).onGetHandler!()).toBe(true);
    expect(service.updates).toContainEqual(['On', true]);

    plug.stopPolling();
  });

  test('getOnState throws SERVICE_COMMUNICATION_FAILURE when the last refresh failed', async () => {
    const { platform, accessory, api } = buildHarness(jest.fn().mockRejectedValue(new Error('offline')));
    const plug = new SmartPlug(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.Switch)!;
    expect(() => service.getCharacteristic(platform.Characteristic.On).onGetHandler!()).toThrow('HapStatusError');

    plug.stopPolling();
  });

  test('setOnState calls setSwitchState and updates the cached state', async () => {
    const { platform, accessory, api, setSwitchState } = buildHarness();
    const plug = new SmartPlug(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.Switch)!;
    const onChar = service.getCharacteristic(platform.Characteristic.On);
    await onChar.onSetHandler!(true);

    expect(setSwitchState).toHaveBeenCalledWith('PLUG001', SwitchTypes.On, true);
    expect(onChar.onGetHandler!()).toBe(true);

    plug.stopPolling();
  });

  test('setOnState throws SERVICE_COMMUNICATION_FAILURE and logs when the API call fails', async () => {
    const { platform, accessory, api, setSwitchState } = buildHarness();
    setSwitchState.mockRejectedValueOnce(new Error('network down'));
    const plug = new SmartPlug(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();

    const service = accessory.getService(platform.Service.Switch)!;
    const onChar = service.getCharacteristic(platform.Characteristic.On);
    await expect(onChar.onSetHandler!(true)).rejects.toThrow('HapStatusError');
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Unable to set switch state for Lamp'),
      expect.any(Error),
    );

    plug.stopPolling();
  });

  test('stopPolling stops further background refreshes', async () => {
    const { platform, accessory, api, getSwitchState } = buildHarness();
    const plug = new SmartPlug(api, platform as unknown as EZVIZPlatform, accessory as never);
    await Promise.resolve();
    expect(getSwitchState).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(getSwitchState).toHaveBeenCalledTimes(2);

    plug.stopPolling();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(getSwitchState).toHaveBeenCalledTimes(2);
  });
});
