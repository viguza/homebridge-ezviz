import type { Service } from 'homebridge';

import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';

const POLL_INTERVAL_MS = 30_000;
const MOTION_WINDOW_MS = 60_000;
// An MQTT push up to this long before the poll noticed the alarm counts as delivering it
// (the poll runs every 30s, so it usually sees an alarm well after its push).
const MQTT_DELIVERED_WINDOW_MS = 90_000;
// How long a push may trail the poll before the alarm counts as missed by MQTT.
const MQTT_LATE_GRACE_MS = 15_000;

type MotionSource = 'mqtt' | 'poll';

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
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastMqttAlarmAt = 0;
  private missCheckTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.lastMqttAlarmAt = Date.now();
    this.triggerMotion('mqtt');
  }

  stopPolling(): void {
    if (this.missCheckTimer) {
      clearTimeout(this.missCheckTimer);
      this.missCheckTimer = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.platform.log.debug(`${this.displayName}: polling stopped`);
    }
  }

  private triggerMotion(source: MotionSource): void {
    // Reset the 60s auto-clear window from now
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
    }
    this.clearTimer = setTimeout(() => this.clearMotion(), MOTION_WINDOW_MS);

    if (!this.motionDetected) {
      this.motionDetected = true;
      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
      this.platform.log.info(`${this.displayName}: motion detected${source === 'mqtt' ? ' (MQTT)' : ' (poll)'}`);
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

  /**
   * After the poll finds a new alarm, checks whether MQTT pushed it too. MQTT can look
   * connected while no longer delivering anything, so an alarm only the poll saw is
   * reported to the platform, which reconnects MQTT. An older timestamp (e.g. the latest
   * alarm was deleted in the EZVIZ app) isn't a new alarm, so it's never checked.
   */
  private checkMqttDelivered(): void {
    const detectedAt = Date.now();
    if (this.lastMqttAlarmAt >= detectedAt - MQTT_DELIVERED_WINDOW_MS || this.missCheckTimer) {
      return;
    }
    this.missCheckTimer = setTimeout(() => {
      this.missCheckTimer = null;
      if (this.lastMqttAlarmAt < detectedAt) {
        this.platform.handleMissedMqttAlarm(this.displayName);
      }
    }, MQTT_LATE_GRACE_MS);
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
        const isNewer = this.lastSeenAlarmTime === null || alarm.time > this.lastSeenAlarmTime;
        this.lastSeenAlarmTime = alarm.time;
        this.triggerMotion('poll');
        if (isNewer) {
          this.checkMqttDelivered();
        }
      }
    } catch (error) {
      this.platform.log.error(`${this.displayName}: motion poll failed:`, error);
    }
  }
}
