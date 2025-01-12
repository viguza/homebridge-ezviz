import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { SwitchTypes } from '../utils/enums.js';

export class SmartPlug {
  private api: EZVIZAPI;

  constructor(
    api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.api = api;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.DeviceInfo.deviceSubCategory)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.Serial);
    
    const plugService = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);
    plugService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.Name);
    plugService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOnState.bind(this))
      .onGet(this.getOnState.bind(this));
  }

  async setOnState(value: CharacteristicValue) {
    try {
      const action = value ? true : false;
      await this.api.setSwitchState(this.accessory.context.device.Serial, SwitchTypes.On, action);
    } catch (error) {
      this.platform.log.error('Unable to set switch state', error);
    }
  }

  async getOnState(): Promise<CharacteristicValue> {
    try {
      return await this.api.getSwitchState(this.accessory.context.device.Serial, SwitchTypes.On);
    } catch (error) {
      this.platform.log.error(`${this.accessory.context.device.Name} (${this.accessory.context.device.Serial}) seems to be unreachable`);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  getAccessory() {
    return this.accessory;
  }
}
