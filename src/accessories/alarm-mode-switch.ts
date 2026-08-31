import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { DefenceMode } from '../utils/enums.js';
import { DEFAULT_GROUP_ID } from '../api/ezviz-constants.js';

const STATE_REFRESH_INTERVAL_MS = 60_000;

/**
 * Alarm Mode Switch accessory for EZVIZ
 * Handles on/off functionality for alarm/defence mode
 * ON = AWAY_MODE (fully armed), OFF = UNSET_MODE (disarmed)
 */
export class AlarmModeSwitch {
  private api: EZVIZAPI;
  private readonly alarmService: Service;
  private currentState = false;
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
      .setCharacteristic(this.platform.Characteristic.Model, 'Alarm Mode Switch')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'EZVIZ-AlarmMode');
    
    // Set up the switch service
    this.alarmService = this.accessory.getService(this.platform.Service.Switch) || 
                       this.accessory.addService(this.platform.Service.Switch, 'Alarm Mode');
    
    this.alarmService.setCharacteristic(this.platform.Characteristic.Name, 'Alarm Mode');
    
    // Set up event handlers. The read answers from cached state so it never waits on
    // the network — HomeKit abandons a read that takes longer than 9s.
    this.alarmService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setAlarmMode.bind(this))
      .onGet(this.getAlarmMode.bind(this));

    this.refreshState();
    this.refreshTimer = setInterval(() => this.refreshState(), STATE_REFRESH_INTERVAL_MS);
  }

  /**
   * Sets the alarm mode (defence mode) on/off
   * @param value - The value to set (true = AWAY_MODE/armed, false = HOME_MODE/disarmed)
   */
  async setAlarmMode(value: CharacteristicValue) {
    try {
      // ON = AWAY_MODE (2) = fully armed, OFF = HOME_MODE (1) = disarmed
      const mode = value ? DefenceMode.AWAY_MODE : DefenceMode.HOME_MODE;
      await this.api.setDefenceMode(DEFAULT_GROUP_ID, mode);
      this.currentState = mode === DefenceMode.AWAY_MODE;
      this.reachable = true;
      this.platform.log.debug(`Successfully set alarm mode to ${value ? 'AWAY_MODE (armed)' : 'HOME_MODE (disarmed)'}`);
    } catch (error) {
      this.platform.log.error('Unable to set alarm mode:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Returns the last known alarm mode without blocking on the network.
   * Reports a communication failure when the most recent refresh failed, rather than
   * reporting the alarm as disarmed when its real state is unknown.
   */
  getAlarmMode(): CharacteristicValue {
    if (!this.reachable) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.currentState;
  }

  /**
   * Refreshes the cached defence mode in the background and pushes any change to HomeKit
   */
  private async refreshState(): Promise<void> {
    try {
      const mode = await this.api.getDefenceMode(DEFAULT_GROUP_ID);
      // Switch is ON only when mode is AWAY_MODE (fully armed)
      const isArmed = mode === DefenceMode.AWAY_MODE;
      this.reachable = true;

      if (isArmed !== this.currentState) {
        this.currentState = isArmed;
        this.alarmService.updateCharacteristic(this.platform.Characteristic.On, isArmed);
        this.platform.log.debug(`Current alarm mode: ${DefenceMode[mode]} (${mode}), switch is ${isArmed ? 'ON' : 'OFF'}`);
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
