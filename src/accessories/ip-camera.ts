import {
  AudioStreamingCodecType, AudioStreamingSamplerate,
  type CameraControllerOptions, type CharacteristicValue, type PlatformAccessory, type Service,
} from 'homebridge';
import { StreamingDelegate } from '../utils/streaming-delegate.js';
import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { SwitchTypes } from '../utils/enums.js';

const STATE_REFRESH_INTERVAL_MS = 60_000;

/**
 * IP Camera accessory for EZVIZ devices
 * Handles video streaming and camera functionality
 */
export class IPCamera {
  private api: EZVIZAPI;
  private deviceSerial: string;
  private readonly operatingModeService: Service | null = null;
  private cameraActive = true;
  private reachable = true;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.api = api;
    this.deviceSerial = accessory.context.device.DeviceInfo.deviceSerial;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.DeviceInfo.deviceSubCategory)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceSerial);

    // Privacy toggle, surfaced as HomeKit's native "Camera Off" control instead of a
    // separate switch accessory. HomeKitCameraActive=true means the camera is active
    // (EZVIZ privacy mode disabled); false means EZVIZ privacy mode is enabled.
    // Not every EZVIZ model exposes a privacy switch, so only wire this up — and only
    // poll for it — when the device's own switch list actually reports one.
    const supportsPrivacySwitch = accessory.context.device.Switches
      ?.some((s: { type: number }) => s.type === SwitchTypes.Privacy) ?? false;

    const existingOperatingModeService = this.accessory.getService(this.platform.Service.CameraOperatingMode);
    if (supportsPrivacySwitch) {
      this.operatingModeService = existingOperatingModeService ||
        this.accessory.addService(this.platform.Service.CameraOperatingMode);

      // EventSnapshotsActive is a required characteristic of this service (per HAP spec) but
      // we don't support HKSV event snapshots — set it statically so the service is valid and
      // the Home app actually renders the "Camera" toggle in the camera's settings sheet.
      this.operatingModeService.setCharacteristic(this.platform.Characteristic.EventSnapshotsActive, true);
      this.operatingModeService.setCharacteristic(this.platform.Characteristic.PeriodicSnapshotsActive, true);

      this.operatingModeService.getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
        .onSet(this.setCameraActive.bind(this))
        .onGet(this.getCameraActive.bind(this));

      this.refreshCameraActiveState();
      this.refreshTimer = setInterval(() => this.refreshCameraActiveState(), STATE_REFRESH_INTERVAL_MS);
    } else if (existingOperatingModeService) {
      // Device no longer reports the switch (e.g. after a firmware change) — drop the stale service.
      this.accessory.removeService(existingOperatingModeService);
    }

    // Create streaming delegate
    const streamingDelegate = new StreamingDelegate(
      this.platform.api.hap,
      accessory.context.device,
      this.platform.log,
      (serial) => this.platform.getAlarmSnapshot(serial),
    );
    
    // Configure camera controller options
    const options: CameraControllerOptions = {
      cameraStreamCount: 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: streamingDelegate,
      streamingOptions: {
        supportedCryptoSuites: [this.platform.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            [320, 180, 30],
            [320, 240, 15], // Apple Watch requires this configuration
            [320, 240, 30],
            [480, 270, 30],
            [480, 360, 30],
            [640, 360, 30],
            [640, 480, 30],
            [1280, 720, 30],
            [1280, 960, 30],
            [1920, 1080, 30],
            [1600, 1200, 30],
          ],
          codec: {
            profiles: [this.platform.api.hap.H264Profile.BASELINE, this.platform.api.hap.H264Profile.MAIN, this.platform.api.hap.H264Profile.HIGH],
            levels: [this.platform.api.hap.H264Level.LEVEL3_1, this.platform.api.hap.H264Level.LEVEL3_2, this.platform.api.hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          twoWayAudio: false,
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_16,
            },
          ],
        },
      },
    };

    try {
      // Create and configure camera controller
      const cameraController = new this.platform.api.hap.CameraController(options);
      streamingDelegate.controller = cameraController;
    
      accessory.configureController(streamingDelegate.controller);
      
      this.platform.log.debug(`Successfully configured camera: ${accessory.context.device.Name}`);
    } catch (error) {
      this.platform.log.error(`Error configuring camera ${accessory.context.device.Name}:`, error);
      throw error;
    }
  }

  /**
   * Sets EZVIZ's privacy switch to match the requested HomeKitCameraActive state
   * @param value - true = camera active (privacy off), false = camera off (privacy on)
   */
  async setCameraActive(value: CharacteristicValue) {
    try {
      const active = Boolean(value);
      await this.api.setSwitchState(this.deviceSerial, SwitchTypes.Privacy, !active);
      this.cameraActive = active;
      this.reachable = true;
      this.platform.log.debug(`${this.accessory.context.device.Name}: camera ${active ? 'active' : 'off (privacy mode)'}`);
    } catch (error) {
      this.platform.log.error(`Unable to set camera active state for ${this.accessory.context.device.Name}:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Returns the last known camera active state without blocking on the network.
   * Reports a communication failure when the most recent refresh could not reach
   * the device, so HomeKit shows "No Response" instead of a stale value.
   */
  getCameraActive(): CharacteristicValue {
    if (!this.reachable) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.cameraActive;
  }

  /**
   * Refreshes the cached privacy state in the background and pushes any change to HomeKit
   */
  private async refreshCameraActiveState(): Promise<void> {
    try {
      const privacyEnabled = await this.api.getSwitchState(this.deviceSerial, SwitchTypes.Privacy);
      const active = !privacyEnabled;
      this.reachable = true;

      if (active !== this.cameraActive) {
        this.cameraActive = active;
        this.operatingModeService!.updateCharacteristic(this.platform.Characteristic.HomeKitCameraActive, active);
        this.platform.log.debug(`${this.accessory.context.device.Name}: camera is now ${active ? 'active' : 'off (privacy mode)'}`);
      }
    } catch (error) {
      this.reachable = false;
      this.platform.log.error(`Unable to refresh camera active state for ${this.accessory.context.device.Name}:`, error);
    }
  }

  /**
   * Stops the background state refresh
   */
  stopPolling(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
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
