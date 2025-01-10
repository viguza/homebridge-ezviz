import { AudioStreamingCodecType, AudioStreamingSamplerate, type CameraControllerOptions, type PlatformAccessory } from 'homebridge';
import { StreamingDelegate } from '../utils/streaming-delegate.js';
import type { EZVIZPlatform } from '../platform.js';
import { EZVIZAPI } from '../api/ezviz-api.js';

export class IPCamera {
  private api: EZVIZAPI;
  private deviceSerial: string;

  constructor(
    api: EZVIZAPI,
    private readonly platform: EZVIZPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.api = api;
    this.deviceSerial = accessory.context.device.DeviceInfo.deviceSerial;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'EZVIZ')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.DeviceInfo.deviceSubCategory)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceSerial);
    
    const streamingDelegate = new StreamingDelegate(this.platform.api.hap, accessory.context.device, this.platform.log);
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

    const cameraController = new this.platform.api.hap.CameraController(options);
    streamingDelegate.controller = cameraController;
  
    accessory.configureController(streamingDelegate.controller);
  }

  getAccessory() {
    return this.accessory;
  }
}
