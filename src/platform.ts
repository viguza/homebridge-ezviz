import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, Service } from 'homebridge';
import { SmartPlug } from './accessories/smart-plug.js';
import { IPCamera } from './accessories/ip-camera.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { EZVIZAPI } from './api/ezviz-api.js';
import { EZVIZConfig, CameraConfig, DeviceConfig } from './types/config.js';
import { Credentials } from './types/login.js';
import { DeviceTypes } from './utils/enums.js';
import { ListDevicesResponse } from './types/devices.js';
import { DeviceData } from './types/data.js';

export class EZVIZPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: EZVIZConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    this.log.debug('Finished initializing platform:', this.config.name);
  }

  async didFinishLaunching(): Promise<void> {
    const ezvizAPI = new EZVIZAPI(this.config, this.log);
    try {
      await this.authenticate(ezvizAPI);
      await this.discoverDevices(ezvizAPI);
    } catch (error) {
      this.log.error('Error during platform initialization', error);
    }

    this.log.debug('Executed didFinishLaunching callback');
  }

  async authenticate(ezvizAPI: EZVIZAPI): Promise<Credentials | undefined> {
    const region = this.config.region;
    const email = this.config.email;
    const password = this.config.password;

    if (!email || !password) {
      this.log.error('You must provide your email and password in config.json.');
      return;
    }

    try {
      this.config.domain = await ezvizAPI.getDomain(region);
      return await ezvizAPI.authenticate();
    } catch (error) {
      this.log.error('Authentication failed', error);
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices(ezvizAPI: EZVIZAPI) {
    try {
      const devicesResponse = await ezvizAPI.listDevices();
      if (devicesResponse?.deviceInfos && devicesResponse?.deviceInfos?.length > 0) {
        for (const device of devicesResponse.deviceInfos) {
          const uuid = this.api.hap.uuid.generate(device.deviceSerial);

          const deviceType = DeviceTypes[device.deviceCategory as keyof typeof DeviceTypes];
          if (!deviceType) {
            this.log.error(`Device ${device.name} has an unsupported type ${device.deviceCategory} and will be skipped`);
            continue;
          }

          const existingAccessory = this.accessories.get(uuid);
          if (existingAccessory && existingAccessory.context.device) {
            existingAccessory.context.device = this.extractDeviceData(device.deviceSerial, devicesResponse);
          }
          if (existingAccessory) {
            this.log.debug(`Restoring existing ${deviceType} from cache: ${existingAccessory.displayName}`);
            if (deviceType === DeviceTypes.Socket) {
              new SmartPlug(ezvizAPI, this, existingAccessory);
            } else if (deviceType === DeviceTypes.IPC) {
              const cameraConfig = (this.config.cameras || []).find((camera) => camera.serial === device.deviceSerial);
              existingAccessory.context.device = this.extractDeviceData(device.deviceSerial, devicesResponse, cameraConfig);
              new IPCamera(ezvizAPI, this, existingAccessory);
            }
          } else {
            this.log.info(`Adding new ${deviceType}: ${device.name}`);
            
            if (deviceType === DeviceTypes.Socket) {
              const accessory = new this.api.platformAccessory(device.name, uuid);
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
              new SmartPlug(ezvizAPI, this, accessory);
            } else if (deviceType === DeviceTypes.IPC) {
              const cameraConfig = (this.config.cameras || []).find((camera) => camera.serial === device.deviceSerial);
              if (!cameraConfig) {
                this.log.info(`Camera ${device.name} (${device.deviceSerial}) is not configured and will be skipped`);
                continue;
              }
              const error = this.cameraConfigErrors(cameraConfig);
              if (error) {
                this.log.info(`Device ${device.name} (${device.deviceSerial}) is not configured correctly and will be skipped: ${error}`);
                continue;
              }
            
              const accessory = new this.api.platformAccessory(device.name, uuid);
              accessory.context.device = this.extractDeviceData(device.deviceSerial, devicesResponse, cameraConfig);
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
              new IPCamera(ezvizAPI, this, accessory);
            }
          }

          this.discoveredCacheUUIDs.push(uuid);
        }
      }

      for (const [uuid, accessory] of this.accessories) {
        if (!this.discoveredCacheUUIDs.includes(uuid)) {
          this.log.info('Removing existing accessory from cache:', accessory.displayName);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    } catch (error) {
      this.log.error('Error discovering devices', error);
    }
  }

  extractDeviceData(deviceSerial: string, devicesResponse: ListDevicesResponse, hbConfig?: DeviceConfig): DeviceData {
    const data = {
      Connection: devicesResponse.CONNECTION[deviceSerial],
      Status: devicesResponse.STATUS[deviceSerial],
      Switches: devicesResponse.SWITCH[deviceSerial],
      P2P: devicesResponse.P2P[deviceSerial],
      ResourceInfo: devicesResponse.resourceInfos.find((resource) => resource.deviceSerial === deviceSerial),
      DeviceInfo: devicesResponse.deviceInfos.find((device) => device.deviceSerial === deviceSerial),
      HBConfig: hbConfig,
    } as DeviceData;

    return data;
  }

  cameraConfigErrors(camera: CameraConfig): string {
    if (!camera.username) {
      return 'No Username';
    }
    if (!camera.code) {
      return 'No Verification Code';
    }
    return '';
  }
}
