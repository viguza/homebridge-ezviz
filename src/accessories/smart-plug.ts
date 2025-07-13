import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { SwitchTypes } from '../utils/enums.js';

/**
 * Smart Plug accessory for EZVIZ devices
 * Handles on/off functionality for smart plugs
 */
export class SmartPlug {
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
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.DeviceInfo.deviceSubCategory)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.Serial);
    
    // Set up the switch service
    const plugService = this.accessory.getService(this.platform.Service.Switch) || 
                       this.accessory.addService(this.platform.Service.Switch);
    
    plugService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.Name);
    
    // Set up event handlers
    plugService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOnState.bind(this))
      .onGet(this.getOnState.bind(this));
  }

  /**
   * Sets the on/off state of the smart plug
   * @param value - The value to set (true for on, false for off)
   */
  async setOnState(value: CharacteristicValue) {
    try {
      const action = value ? true : false;
      await this.api.setSwitchState(this.accessory.context.device.Serial, SwitchTypes.On, action);
      this.platform.log.debug(`Successfully set ${this.accessory.context.device.Name} to ${action ? 'ON' : 'OFF'}`);
    } catch (error) {
      this.platform.log.error(`Unable to set switch state for ${this.accessory.context.device.Name}:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Gets the current on/off state of the smart plug
   * @returns Promise resolving to the current state
   */
  async getOnState(): Promise<CharacteristicValue> {
    try {
      const state = await this.api.getSwitchState(this.accessory.context.device.Serial, SwitchTypes.On);
      this.platform.log.debug(`${this.accessory.context.device.Name} is currently ${state ? 'ON' : 'OFF'}`);
      return state;
    } catch (error) {
      this.platform.log.error(`${this.accessory.context.device.Name} (${this.accessory.context.device.Serial}) seems to be unreachable:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
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
