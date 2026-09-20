import type { Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';

const POLL_INTERVAL_MS = 30_000;
const MOTION_WINDOW_MS = 60_000;

/**
 * Drives a HomeKit Motion Sensor service via MQTT push / REST poll. This does not own an
 * accessory — the service is created by IPCamera and linked to the camera's primary
 * service, so Home can associate a motion notification with that specific camera and
 * offer a live preview. See IPCamera.getMotionService.
 */
export class CameraMotionSensor {
  private motionDetected = false;
  private lastSeenAlarmTime: number | null | undefined = undefined;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private usingMqtt = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly service: Service,
    private readonly serial: string,
    private readonly displayName: string,
  ) {
    this.service.setCharacteristic(this.platform.Characteristic.Name, `${displayName} Motion`);

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
      this.platform.log.debug(`${this.displayName}: polling stopped`);
    }
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
      this.platform.log.info(`${this.displayName}: motion detected${this.usingMqtt ? ' (MQTT)' : ''}`);
    }
  }

  private clearMotion(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.motionDetected = false;
    this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
    this.platform.log.debug(`${this.displayName}: motion cleared`);
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
        this.platform.updateAlarmSnapshot(this.serial, alarm.picUrl, alarm.time);
      }

      if (this.lastSeenAlarmTime === undefined) {
        this.lastSeenAlarmTime = alarm.time;
        this.platform.log.debug(`${this.displayName}: initialised alarmTime=${alarm.time}`);
        return;
      }

      if (alarm.time !== this.lastSeenAlarmTime) {
        this.platform.log.debug(`${this.displayName}: new alarm via poll (${this.lastSeenAlarmTime} → ${alarm.time})`);
        this.lastSeenAlarmTime = alarm.time;
        this.triggerMotion();
      }
    } catch (error) {
      this.platform.log.error(`${this.displayName}: motion poll failed:`, error);
    }
  }
}
