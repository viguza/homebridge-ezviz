import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';

/**
 * Generic camera switch accessory for any EZVIZ DeviceSwitchType.
 * The switch type, serial, and channel are stored in accessory.context
 * so a single class handles privacy, infrared, light, etc.
 */
export class CameraSwitch {
  constructor(
    private readonly api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, 'Camera Switch')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.serial);

    const service = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
  }

  private get serial(): string {
    return this.accessory.context.serial;
  }

  private get switchType(): number {
    return this.accessory.context.switchType;
  }

  private get channelNo(): number {
    return this.accessory.context.channelNo ?? 0;
  }

  async setOn(value: CharacteristicValue): Promise<void> {
    try {
      await this.api.setSwitchState(this.serial, this.switchType, value as boolean, this.channelNo);
      this.platform.log.debug(`${this.accessory.displayName} set to ${value}`);
    } catch (error) {
      this.platform.log.error(`Failed to set ${this.accessory.displayName}:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    try {
      return await this.api.getSwitchState(this.serial, this.switchType);
    } catch (error) {
      this.platform.log.error(`Failed to get ${this.accessory.displayName}:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
