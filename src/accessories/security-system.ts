import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { DefenceMode } from '../utils/enums.js';
import { DEFAULT_GROUP_ID } from '../api/ezviz-constants.js';

const STATE_REFRESH_INTERVAL_MS = 60_000;

/**
 * Maps an EZVIZ defence mode to the corresponding SecuritySystem state value.
 * HomeKit's SecuritySystemCurrentState/TargetState share the same numbering
 * for STAY_ARM/AWAY_ARM/NIGHT_ARM; DISARMED/DISARM only differ in value on Current vs Target.
 */
export function defenceModeToState(mode: DefenceMode): number {
  switch (mode) {
  case DefenceMode.HOME_MODE:
    return 0; // STAY_ARM
  case DefenceMode.AWAY_MODE:
    return 1; // AWAY_ARM
  case DefenceMode.SLEEP_MODE:
    return 2; // NIGHT_ARM
  case DefenceMode.UNSET_MODE:
  default:
    return 3; // DISARMED / DISARM
  }
}

/**
 * On real hardware, EZVIZ only ever reports HOME_MODE as "Desarmado" (disarmed) — UNSET_MODE
 * does not behave as disarmed and shows as "Armado" instead (confirmed against a live device).
 * Since there is no working EZVIZ mode for "fully off", both STAY_ARM and DISARM map to
 * HOME_MODE — it's the only mode that actually disarms the device.
 */
export function targetStateToDefenceMode(state: CharacteristicValue): DefenceMode {
  switch (state) {
  case 1:
    return DefenceMode.AWAY_MODE;
  case 2:
    return DefenceMode.SLEEP_MODE;
  case 0: // STAY_ARM
  case 3: // DISARM
  default:
    return DefenceMode.HOME_MODE;
  }
}

/**
 * Security System accessory for EZVIZ
 * Exposes EZVIZ's defence mode as a native HomeKit SecuritySystem (Stay/Away/Night/Off)
 * instead of a plain on/off Switch, so Home/Away automations and Apple Watch controls work.
 */
export class SecuritySystemAccessory {
  private api: EZVIZAPI;
  private readonly securityService: Service;
  private currentMode: DefenceMode = DefenceMode.UNSET_MODE;
  private reachable = true;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.api = api;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, 'Security System')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'EZVIZ-AlarmMode');

    // An accessory upgraded from the old alarm-mode Switch still carries that service;
    // drop it so the accessory shows a single SecuritySystem tile, not both.
    const staleSwitch = this.accessory.getService(this.platform.Service.Switch);
    if (staleSwitch) {
      this.accessory.removeService(staleSwitch);
    }

    this.securityService = this.accessory.getService(this.platform.Service.SecuritySystem) ||
      this.accessory.addService(this.platform.Service.SecuritySystem, 'Alarm Mode');

    this.securityService.setCharacteristic(this.platform.Characteristic.Name, 'Alarm Mode');

    // Set up event handlers. The read answers from cached state so it never waits on
    // the network — HomeKit abandons a read that takes longer than 9s.
    this.securityService.getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
      .onSet(this.setTargetState.bind(this))
      .onGet(this.getState.bind(this));

    this.securityService.getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
      .onGet(this.getState.bind(this));

    this.refreshState();
    this.refreshTimer = setInterval(() => this.refreshState(), STATE_REFRESH_INTERVAL_MS);
  }

  /**
   * Sets the defence mode (alarm mode) to match the requested SecuritySystem target state
   * @param value - The requested SecuritySystemTargetState (Stay/Away/Night/Disarm)
   */
  async setTargetState(value: CharacteristicValue) {
    try {
      const mode = targetStateToDefenceMode(value);
      await this.api.setDefenceMode(DEFAULT_GROUP_ID, mode);
      this.currentMode = mode;
      this.reachable = true;
      this.securityService.updateCharacteristic(
        this.platform.Characteristic.SecuritySystemCurrentState,
        defenceModeToState(mode),
      );
      this.platform.log.debug(`Successfully set alarm mode to ${DefenceMode[mode]}`);
    } catch (error) {
      this.platform.log.error('Unable to set alarm mode:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Returns the last known alarm mode, mapped to a SecuritySystem state value,
   * without blocking on the network. Used for both Current and Target state reads.
   * Reports a communication failure when the most recent refresh failed, rather than
   * reporting the alarm as disarmed when its real state is unknown.
   */
  getState(): CharacteristicValue {
    if (!this.reachable) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return defenceModeToState(this.currentMode);
  }

  /**
   * Refreshes the cached defence mode in the background and pushes any change to HomeKit
   */
  private async refreshState(): Promise<void> {
    try {
      const mode = await this.api.getDefenceMode(DEFAULT_GROUP_ID);
      this.reachable = true;

      if (mode !== this.currentMode) {
        this.currentMode = mode;
        const state = defenceModeToState(mode);
        this.securityService.updateCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState, state);
        this.securityService.updateCharacteristic(this.platform.Characteristic.SecuritySystemTargetState, state);
        this.platform.log.debug(`Current alarm mode: ${DefenceMode[mode]} (${mode})`);
      }
    } catch (error) {
      this.reachable = false;
      this.platform.log.error('Unable to get alarm mode:', error);
    }
  }

  /**
   * Stops the background state refresh
   */
  stopPolling(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Gets the accessory instance
   * @returns The platform accessory
   */
  getAccessory() {
    return this.accessory;
  }
}
