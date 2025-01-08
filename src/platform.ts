import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, Service } from 'homebridge';
import { SmartPlug } from './accessories/smart-plug.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { EZVIZAPI } from './api/ezviz-api.js';
import { EZVIZConfig } from './types/config.js';
import { Credentials } from './types/connection.js';
import { DeviceTypes } from './utils/enums.js';

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
    const ezvizAPI = new EZVIZAPI(this.config);
    await this.authenticate(ezvizAPI);
    this.log.debug('Successful login');
    await this.discoverDevices(ezvizAPI);

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

    this.config.domain = await ezvizAPI.getDomain(region);
    return await ezvizAPI.authenticate();
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices(ezvizAPI: EZVIZAPI) {
    const devicesResponse = await ezvizAPI.listDevices();
    if (devicesResponse?.deviceInfos && devicesResponse?.deviceInfos?.length > 0) {
      for (const device of devicesResponse.deviceInfos) {
        const uuid = this.api.hap.uuid.generate(device.deviceSerial);

        const deviceType = DeviceTypes[device.deviceCategory as keyof typeof DeviceTypes];
        if (!deviceType) {
          this.log.info(`Device ${device.name} has an unsupported type ${device.deviceCategory}`);
          continue;
        }

        const existingAccessory = this.accessories.get(uuid);
        if (existingAccessory) {
          this.log.info(`Restoring existing ${deviceType} from cache: ${existingAccessory.displayName}`);
          if (deviceType === DeviceTypes.Socket) {
            new SmartPlug(ezvizAPI, this, existingAccessory);
          }
        } else {
          this.log.info(`Adding new ${deviceType}: ${device.name}`);
          if (deviceType === DeviceTypes.Socket) {
            const accessory = new this.api.platformAccessory(device.name, uuid);
            accessory.context.device = device;
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            new SmartPlug(ezvizAPI, this, accessory);
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
  }
}
