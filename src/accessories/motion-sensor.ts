import type { PlatformAccessory, Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';

const POLL_INTERVAL_MS = 30_000;
const MOTION_WINDOW_MS = 60_000;

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

  // Called by MQTT — real-time push, trigger immediately regardless of timestamp.
  onMqttAlarm(): void {
    this.usingMqtt = true;
    this.triggerMotion();
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.platform.log.debug(`${this.accessory.displayName}: polling stopped`);
    }
  }

  private get serial(): string {
    return this.accessory.context.serial;
  }

  private triggerMotion(): void {
    // Reset the 60s auto-clear window from now
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
    }
    this.clearTimer = setTimeout(() => this.clearMotion(), MOTION_WINDOW_MS);

    if (!this.motionDetected) {
      this.motionDetected = true;
      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
      this.platform.log.info(`${this.accessory.displayName}: motion detected${this.usingMqtt ? ' (MQTT)' : ''}`);
    }
  }

  private clearMotion(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.motionDetected = false;
    this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
    this.platform.log.debug(`${this.accessory.displayName}: motion cleared`);
  }

  // Poll uses change detection: trigger when the REST API alarm timestamp changes,
  // regardless of how old that timestamp is. Clears are handled by the timer only.
  private async poll(): Promise<void> {
    try {
      const alarm = await this.api.getLatestAlarm(this.serial);
      if (alarm === null) {
        return;
      }

      if (alarm.picUrl) {
        this.platform.updateAlarmSnapshot(this.serial, alarm.picUrl);
      }

      if (this.lastSeenAlarmTime === undefined) {
        this.lastSeenAlarmTime = alarm.time;
        this.platform.log.debug(`${this.accessory.displayName}: initialised alarmTime=${alarm.time}`);
        return;
      }

      if (alarm.time !== this.lastSeenAlarmTime) {
        this.platform.log.debug(`${this.accessory.displayName}: new alarm via poll (${this.lastSeenAlarmTime} → ${alarm.time})`);
        this.lastSeenAlarmTime = alarm.time;
        this.triggerMotion();
      }
    } catch (error) {
      this.platform.log.error(`${this.accessory.displayName}: motion poll failed:`, error);
    }
  }
}
