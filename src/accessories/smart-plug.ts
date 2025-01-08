import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { SwitchTypes } from '../utils/enums.js';

export class SmartPlug {
  private api: EZVIZAPI;
  private deviceSerial: string;
  private deviceName: string;

  constructor(
    api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.api = api;
    this.deviceSerial = accessory.context.device.deviceSerial;
    this.deviceName = accessory.context.device.name;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.deviceSubCategory)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceSerial);
    
    const plugService = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);
    plugService.setCharacteristic(this.platform.Characteristic.Name, this.deviceName);
    plugService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOnState.bind(this))
      .onGet(this.getOnState.bind(this));
  }

  async setOnState(value: CharacteristicValue) {
    const action = value ? true : false;
    await this.api.setSwitchState(this.deviceSerial, SwitchTypes.On, action);
  }

  async getOnState(): Promise<CharacteristicValue> {
    const state = await this.api.getSwitchState(this.deviceSerial, SwitchTypes.On);
    if (state === undefined) {
      this.platform.log.error(`${this.deviceName} seems to be unreachable`);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return state;
  }

  getAccessory() {
    return this.accessory;
  }
}