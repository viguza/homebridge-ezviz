import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { DefenceMode } from '../utils/enums.js';
import { DEFAULT_GROUP_ID } from '../api/ezviz-constants.js';

/**
 * Alarm Mode Switch accessory for EZVIZ
 * Handles on/off functionality for alarm/defence mode
 * ON = AWAY_MODE (fully armed), OFF = UNSET_MODE (disarmed)
 */
export class AlarmModeSwitch {
  private api: EZVIZAPI;

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
    const alarmService = this.accessory.getService(this.platform.Service.Switch) || 
                       this.accessory.addService(this.platform.Service.Switch, 'Alarm Mode');
    
    alarmService.setCharacteristic(this.platform.Characteristic.Name, 'Alarm Mode');
    
    // Set up event handlers
    alarmService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setAlarmMode.bind(this))
      .onGet(this.getAlarmMode.bind(this));
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
      this.platform.log.debug(`Successfully set alarm mode to ${value ? 'AWAY_MODE (armed)' : 'HOME_MODE (disarmed)'}`);
    } catch (error) {
      this.platform.log.error('Unable to set alarm mode:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Gets the current alarm mode (defence mode) state
   * @returns Promise resolving to the current state (true = armed, false = disarmed)
   */
  async getAlarmMode(): Promise<CharacteristicValue> {
    try {
      const mode = await this.api.getDefenceMode(DEFAULT_GROUP_ID);
      // Return true if mode is AWAY_MODE (fully armed), false otherwise
      const isArmed = mode === DefenceMode.AWAY_MODE;
      this.platform.log.debug(`Current alarm mode: ${DefenceMode[mode]} (${mode}), switch is ${isArmed ? 'ON' : 'OFF'}`);
      return isArmed;
    } catch (error) {
      this.platform.log.error('Unable to get alarm mode:', error);
      // Return false (disarmed) as default on error
      return false;
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

