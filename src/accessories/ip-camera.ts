import {
  AudioBitrate,
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
  AudioStreamingCodecType, AudioStreamingSamplerate,
  MediaContainerType,
  type CameraController, type CameraControllerOptions, type CharacteristicValue, type PlatformAccessory, type Service,
} from 'homebridge';
import { StreamingDelegate } from '../utils/streaming-delegate.js';
import { HksvRecordingDelegate } from '../utils/hksv-recording-delegate.js';
import { getRtspUrl } from '../utils/rtsp-url.js';
import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';
import { SwitchTypes } from '../utils/enums.js';

const STATE_REFRESH_INTERVAL_MS = 60_000;
const HKSV_PREBUFFER_LENGTH_MS = 4000;

/**
 * IP Camera accessory for EZVIZ devices
 * Handles video streaming and camera functionality
 */
export class IPCamera {
  private api: EZVIZAPI;
  private deviceSerial: string;
  private operatingModeService: Service | null = null;
  private readonly streamingDelegate: StreamingDelegate;
  private readonly motionService: Service;
  private cameraController?: CameraController;
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

    // Not every EZVIZ model exposes a privacy switch, so only wire up the toggle below —
    // and only poll for it — when the device's own switch list actually reports one.
    const supportsPrivacySwitch = accessory.context.device.Switches
      ?.some((s: { type: number }) => s.type === SwitchTypes.Privacy) ?? false;
    const hksvEnabled = Boolean(this.platform.config.enableHksv);

    // CameraOperatingMode is also created internally by HAP-NodeJS's RecordingManagement
    // whenever `recording` options are supplied below — it's the one service here that
    // isn't exclusively ours, so a stale instance from a previous run (e.g. HKSV just got
    // toggled on/off) can't safely be reused: drop any existing one and let whichever path
    // owns it this run — RecordingManagement for HKSV, or us for privacy-only — create it
    // fresh. Without this, a leftover manually-created instance collides with the one
    // RecordingManagement creates as soon as HKSV is turned on.
    const existingOperatingModeService = this.accessory.getService(this.platform.Service.CameraOperatingMode);
    if (existingOperatingModeService) {
      this.accessory.removeService(existingOperatingModeService);
    }

    if (!hksvEnabled && supportsPrivacySwitch) {
      // Privacy toggle, surfaced as HomeKit's native "Camera Off" control instead of a
      // separate switch accessory. HomeKitCameraActive=true means the camera is active
      // (EZVIZ privacy mode disabled); false means EZVIZ privacy mode is enabled.
      this.operatingModeService = this.accessory.addService(this.platform.Service.CameraOperatingMode);

      // EventSnapshotsActive/PeriodicSnapshotsActive are required characteristics of this
      // service per the HAP spec — set statically so the service is valid and the Home app
      // actually renders the "Camera" toggle in the camera's settings sheet.
      this.operatingModeService.setCharacteristic(this.platform.Characteristic.EventSnapshotsActive, true);
      this.operatingModeService.setCharacteristic(this.platform.Characteristic.PeriodicSnapshotsActive, true);

      this.wirePrivacyToggle(this.operatingModeService);
    }

    // Create streaming delegate
    const streamingDelegate = new StreamingDelegate(
      this.platform.api.hap,
      accessory.context.device,
      this.platform.log,
      (serial) => this.platform.getAlarmSnapshot(serial),
    );
    this.streamingDelegate = streamingDelegate;

    // Get-or-create the Motion Sensor service up front so it can be handed to the
    // CameraController below via `sensors.motion` — that's the mechanism HAP-NodeJS
    // uses both to correctly link the sensor to this camera accessory (its own
    // addLinkedService plumbing does this for us) and, when HKSV recording is enabled,
    // to recognize it as the recording trigger. CameraMotionSensor drives this service.
    this.motionService = this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    const rtspUrl = getRtspUrl(accessory.context.device);

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
      sensors: {
        motion: this.motionService,
      },
      recording: hksvEnabled ? {
        options: {
          prebufferLength: HKSV_PREBUFFER_LENGTH_MS,
          mediaContainerConfiguration: {
            type: MediaContainerType.FRAGMENTED_MP4,
            fragmentLength: HKSV_PREBUFFER_LENGTH_MS,
          },
          video: {
            type: 0, // VideoCodecType.H264 — not re-exported by the `homebridge` package; it's the only member
            parameters: {
              profiles: [this.platform.api.hap.H264Profile.BASELINE, this.platform.api.hap.H264Profile.MAIN, this.platform.api.hap.H264Profile.HIGH],
              levels: [this.platform.api.hap.H264Level.LEVEL3_1, this.platform.api.hap.H264Level.LEVEL3_2, this.platform.api.hap.H264Level.LEVEL4_0],
            },
            // HAP requires at least 1920x1080 and 1280x720 at 15fps, plus 24 or 30fps.
            resolutions: [
              [1920, 1080, 30],
              [1920, 1080, 15],
              [1280, 720, 30],
              [1280, 720, 15],
            ],
          },
          audio: {
            codecs: [{
              type: AudioRecordingCodecType.AAC_LC,
              audioChannels: 1,
              bitrateMode: AudioBitrate.VARIABLE,
              samplerate: [AudioRecordingSamplerate.KHZ_32],
            }],
          },
        },
        delegate: new HksvRecordingDelegate(
          rtspUrl,
          accessory.context.device.Name,
          this.platform.log,
          () => Boolean(this.cameraController?.recordingManagement?.operatingModeService
            .getCharacteristic(this.platform.Characteristic.RecordingAudioActive).value),
        ),
      } : undefined,
    };

    try {
      // Create and configure camera controller
      const cameraController = new this.platform.api.hap.CameraController(options);
      this.cameraController = cameraController;
      streamingDelegate.controller = cameraController;

      accessory.configureController(cameraController);

      // With HKSV enabled, RecordingManagement (above) owns CameraOperatingMode instead
      // of us — wire the privacy toggle onto its instance rather than creating our own.
      if (hksvEnabled) {
        this.operatingModeService = cameraController.recordingManagement!.operatingModeService;
        if (supportsPrivacySwitch) {
          this.wirePrivacyToggle(this.operatingModeService);
        }
      }

      this.platform.log.debug(`Successfully configured camera: ${accessory.context.device.Name}`);
    } catch (error) {
      this.platform.log.error(`Error configuring camera ${accessory.context.device.Name}:`, error);
      throw error;
    }
  }

  /**
   * Wires the privacy on/off handlers and background refresh onto a CameraOperatingMode
   * service — either one we created ourselves (no HKSV) or the one RecordingManagement
   * owns (HKSV enabled). Only called when the device actually reports a privacy switch.
   */
  private wirePrivacyToggle(service: Service): void {
    service.getCharacteristic(this.platform.Characteristic.HomeKitCameraActive)
      .onSet(this.setCameraActive.bind(this))
      .onGet(this.getCameraActive.bind(this));

    this.refreshCameraActiveState();
    this.refreshTimer = setInterval(() => this.refreshCameraActiveState(), STATE_REFRESH_INTERVAL_MS);
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
   * Returns the Motion Sensor service for this camera, for CameraMotionSensor to drive.
   * Created up front in the constructor and handed to the CameraController via
   * `sensors.motion`, so HAP-NodeJS owns linking it to the camera correctly.
   */
  getMotionService(): Service {
    return this.motionService;
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
