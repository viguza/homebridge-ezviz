import type { PlatformAccessory, Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';

const POLL_INTERVAL_MS = 30_000;
// How long motion stays active after a new alarm is detected
const MOTION_WINDOW_MS = 90_000;

export class MotionSensor {
  private readonly service: Service;
  private motionDetected = false;
  // undefined = first poll not yet done (don't trigger on startup)
  private lastSeenAlarmTime: number | null | undefined = undefined;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, 'Motion Sensor')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.serial);

    this.service = this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(() => this.motionDetected);

    this.poll();
    setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private get serial(): string {
    return this.accessory.context.serial;
  }

  private async poll(): Promise<void> {
    try {
      const alarmTime = await this.api.getLastAlarmTime(this.serial);

      // First poll: initialise without triggering (avoids false motion on startup)
      if (this.lastSeenAlarmTime === undefined) {
        this.lastSeenAlarmTime = alarmTime;
        this.platform.log.debug(`${this.accessory.displayName}: initialised alarmTime=${alarmTime}`);
        return;
      }

      const isNew = alarmTime !== null && alarmTime !== this.lastSeenAlarmTime;
      this.platform.log.debug(
        `${this.accessory.displayName}: alarmTime=${alarmTime} lastSeen=${this.lastSeenAlarmTime} newAlarm=${isNew}`,
      );

      if (alarmTime !== null) {
        this.lastSeenAlarmTime = alarmTime;
      }

      if (isNew) {
        if (this.clearTimer) {
          clearTimeout(this.clearTimer);
        }
        this.motionDetected = true;
        this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
        this.platform.log.info(`${this.accessory.displayName}: motion detected`);

        this.clearTimer = setTimeout(() => {
          this.motionDetected = false;
          this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
          this.platform.log.debug(`${this.accessory.displayName}: motion cleared`);
        }, MOTION_WINDOW_MS);
      }
    } catch (error) {
      this.platform.log.error(`${this.accessory.displayName}: motion poll failed:`, error);
    }
  }
}
