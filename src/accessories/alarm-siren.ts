import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';

// EZVIZ sirens auto-stop after ~30 seconds; reset the switch to OFF after this delay
const SIREN_AUTO_RESET_MS = 30_000;

export class AlarmSiren {
  private readonly service: Service;
  private active = false;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, 'Alarm Siren')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.serial);

    this.service = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(() => this.active);
  }

  private get serial(): string {
    return this.accessory.context.serial;
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const enable = value as boolean;

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    try {
      if (enable) {
        await this.api.soundAlarm(this.serial);
        this.active = true;
        this.platform.log.debug(`${this.accessory.displayName}: siren triggered`);

        // Auto-reset to OFF when the siren times out on the device
        this.resetTimer = setTimeout(() => {
          this.active = false;
          this.service.updateCharacteristic(this.platform.Characteristic.On, false);
          this.platform.log.debug(`${this.accessory.displayName}: siren auto-reset`);
        }, SIREN_AUTO_RESET_MS);
      } else {
        await this.api.cancelAlarm(this.serial);
        this.active = false;
        this.platform.log.debug(`${this.accessory.displayName}: siren cancelled`);
      }
    } catch (error) {
      this.platform.log.error(`${this.accessory.displayName}: failed to ${enable ? 'trigger' : 'cancel'} siren:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
