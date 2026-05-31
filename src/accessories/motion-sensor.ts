import type { PlatformAccessory, Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';

const POLL_INTERVAL_MS = 30_000;
const MOTION_WINDOW_MS = 90_000;

export class MotionSensor {
  private readonly service: Service;
  private motionDetected = false;
  private lastSeenAlarmTime: number | null | undefined = undefined;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private usingMqtt = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

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
    this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /**
   * Called by the MQTT client when a push event arrives for this camera.
   * Switches the sensor to MQTT mode — polling continues as a fallback
   * but won't trigger motion once MQTT is active.
   */
  onMqttAlarm(alarmTime: number): void {
    if (!this.usingMqtt) {
      this.usingMqtt = true;
      // MQTT confirmed working — stop the polling interval
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
        this.platform.log.debug(`${this.accessory.displayName}: polling stopped, using MQTT`);
      }
    }
    if (alarmTime !== this.lastSeenAlarmTime) {
      this.lastSeenAlarmTime = alarmTime;
      this.triggerMotion();
    }
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.usingMqtt = true;
      this.platform.log.debug(`${this.accessory.displayName}: polling stopped, using MQTT`);
    }
  }

  private get serial(): string {
    return this.accessory.context.serial;
  }

  private triggerMotion(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
    }
    this.motionDetected = true;
    this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
    this.platform.log.info(`${this.accessory.displayName}: motion detected${this.usingMqtt ? ' (MQTT)' : ''}`);

    this.clearTimer = setTimeout(() => {
      this.motionDetected = false;
      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
      this.platform.log.debug(`${this.accessory.displayName}: motion cleared`);
    }, MOTION_WINDOW_MS);
  }

  private async poll(): Promise<void> {
    // When MQTT is active, polling still runs but only initialises state — no triggering
    try {
      const alarmTime = await this.api.getLastAlarmTime(this.serial);

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
        this.triggerMotion();
      }
    } catch (error) {
      this.platform.log.error(`${this.accessory.displayName}: motion poll failed:`, error);
    }
  }
}
