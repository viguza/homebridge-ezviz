import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, Service } from 'homebridge';
import { SmartPlug } from './accessories/smart-plug.js';
import { IPCamera } from './accessories/ip-camera.js';
import { AlarmModeSwitch } from './accessories/alarm-mode-switch.js';
import { MotionSensor } from './accessories/motion-sensor.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { EZVIZAPI } from './api/ezviz-api.js';
import { EZVIZConfig, CameraConfig } from './types/config.js';
import { Credentials } from './types/login.js';
import { DeviceTypes } from './utils/enums.js';
import { ListDevicesResponse } from './types/devices.js';
import { DeviceData } from './types/data.js';

/**
 * EZVIZ Platform for Homebridge
 * Handles device discovery, authentication, and accessory management
 */
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

  /**
   * Called when Homebridge finishes launching
   * Handles authentication and device discovery
   */
  async didFinishLaunching(): Promise<void> {
    try {
      const ezvizAPI = new EZVIZAPI(this.config, this.log);
      const credentials = await this.authenticate(ezvizAPI);
      
      if (credentials) {
        // Refresh session every 12 hours (uses refresh token, falls back to full re-auth)
        setInterval(async () => {
          this.log.debug('Refreshing EZVIZ session');
          try {
            await ezvizAPI.refreshSession();
          } catch (error) {
            this.log.error('Session refresh failed:', error);
          }
        }, 3600000 * 12);
        
        await this.discoverDevices(ezvizAPI);
      } else {
        this.log.error('Could not authenticate with EZVIZ API. Please check your credentials.');
      }
    } catch (error) {
      this.log.error('Error during platform initialization:', error);
    }

    this.log.debug('Executed didFinishLaunching callback');
  }

  /**
   * Authenticates with the EZVIZ API
   * @param ezvizAPI - The EZVIZ API instance
   * @returns Promise resolving to credentials or undefined if authentication fails
   */
  async authenticate(ezvizAPI: EZVIZAPI): Promise<Credentials | undefined> {
    const region = this.config.region;
    const email = this.config.email;
    const password = this.config.password;

    if (!email || !password) {
      this.log.error('You must provide your email and password in config.json.');
      return;
    }

    if (!region) {
      this.log.error('You must provide your region in config.json.');
      return;
    }

    try {
      this.config.domain = await ezvizAPI.getDomain(region);
      const credentials = await ezvizAPI.authenticate();
      
      if (credentials) {
        this.log.info('Successfully authenticated with EZVIZ API');
      }
      
      return credentials;
    } catch (error) {
      this.log.error('Authentication failed:', error);
      return;
    }
  }

  /**
   * Configures an accessory from cache
   * @param accessory - The accessory to configure
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Discovers and manages EZVIZ devices
   * @param ezvizAPI - The EZVIZ API instance
   */
  async discoverDevices(ezvizAPI: EZVIZAPI) {
    try {
      const devicesResponse = await ezvizAPI.listDevices();
      if (!devicesResponse) {
        this.log.error('No devices found or failed to retrieve device list');
        return;
      }
      
      const devices = this.extractDevicesData(devicesResponse);
      this.log.info(`Found ${devices.length} devices`);
      
      for (const device of devices) {
        const existingAccessory = this.accessories.get(device.UUID);
        if (existingAccessory) {
          this.log.debug(`Restoring existing ${device.Type} from cache: ${existingAccessory.displayName}`);
          existingAccessory.context.device = device;
          this.createAccessory(ezvizAPI, existingAccessory, device.Type);
        } else {
          this.log.info(`Adding new ${device.Type}: ${device.Name}`);
          const accessory = new this.api.platformAccessory(device.Name, device.UUID);
          accessory.context.device = device;
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.createAccessory(ezvizAPI, accessory, device.Type);
        }

        this.discoveredCacheUUIDs.push(device.UUID);

        if (device.Type === DeviceTypes.IPC || device.Type === DeviceTypes.CatEye) {
          if ((device.HBConfig as CameraConfig | undefined)?.motionSensor) {
            this.createMotionSensor(ezvizAPI, device);
          }
        }
      }

      // Create a single alarm mode switch accessory
      const alarmUuid = this.api.hap.uuid.generate('EZVIZ-AlarmMode');
      const existingAlarmAccessory = this.accessories.get(alarmUuid);

      if (existingAlarmAccessory) {
        this.log.debug('Restoring existing alarm mode switch from cache');
        new AlarmModeSwitch(ezvizAPI, this, existingAlarmAccessory);
      } else {
        this.log.info('Adding new alarm mode switch');
        const alarmAccessory = new this.api.platformAccessory('Alarm Mode', alarmUuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [alarmAccessory]);
        new AlarmModeSwitch(ezvizAPI, this, alarmAccessory);
      }

      this.discoveredCacheUUIDs.push(alarmUuid);

      // Remove accessories that are no longer available
      for (const [uuid, accessory] of this.accessories) {
        if (!this.discoveredCacheUUIDs.includes(uuid)) {
          this.log.info('Removing existing accessory from cache:', accessory.displayName);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    } catch (error) {
      this.log.error('Error discovering devices:', error);
    }
  }

  /**
   * Creates the appropriate accessory based on device type
   * @param ezvizAPI - The EZVIZ API instance
   * @param accessory - The platform accessory
   * @param deviceType - The type of device
   */
  private createAccessory(ezvizAPI: EZVIZAPI, accessory: PlatformAccessory, deviceType: string) {
    try {
      if (deviceType === DeviceTypes.Socket) {
        new SmartPlug(ezvizAPI, this, accessory);
      } else if (deviceType === DeviceTypes.IPC || deviceType === DeviceTypes.CatEye) {
        new IPCamera(ezvizAPI, this, accessory);
      } else {
        this.log.warn(`Unsupported device type: ${deviceType}`);
      }
    } catch (error) {
      this.log.error(`Error creating accessory for ${accessory.displayName}:`, error);
    }
  }

  private createMotionSensor(ezvizAPI: EZVIZAPI, device: DeviceData) {
    const uuid = this.api.hap.uuid.generate(`${device.Serial}-motion`);
    const name = `${device.Name} Motion`;
    const existing = this.accessories.get(uuid);

    if (existing) {
      this.log.debug(`Restoring existing motion sensor from cache: ${existing.displayName}`);
      existing.context.serial = device.Serial;
      new MotionSensor(ezvizAPI, this, existing);
    } else {
      this.log.info(`Adding new motion sensor: ${name}`);
      const accessory = new this.api.platformAccessory(name, uuid);
      accessory.context.serial = device.Serial;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      new MotionSensor(ezvizAPI, this, accessory);
    }

    this.discoveredCacheUUIDs.push(uuid);
  }

  /**
   * Extracts device data from the API response
   * @param devicesResponse - The API response containing device information
   * @returns Array of processed device data
   */
  extractDevicesData(devicesResponse: ListDevicesResponse): DeviceData[] {
    const devices: DeviceData[] = [];

    for (const device of devicesResponse.deviceInfos) {
      const uuid = this.api.hap.uuid.generate(device.deviceSerial);

      const deviceType = DeviceTypes[device.deviceCategory as keyof typeof DeviceTypes];
      if (!deviceType) {
        this.log.error(`Device ${device.name} has an unsupported type ${device.deviceCategory} and will be skipped`);
        continue;
      }

      let deviceConfig;
      if (deviceType === DeviceTypes.Socket) {
        deviceConfig = this.config.plugs?.find((plug) => plug.serial === device.deviceSerial);
      } else if (deviceType === DeviceTypes.IPC || deviceType === DeviceTypes.CatEye) {
        deviceConfig = this.config.cameras?.find((camera) => camera.serial === device.deviceSerial);
        if (!deviceConfig) {
          this.log.info(`Camera ${device.name} (${device.deviceSerial}) is not configured and will be skipped`);
          continue;
        }
        const error = this.cameraConfigErrors(deviceConfig as CameraConfig);
        if (error) {
          this.log.info(`Device ${device.name} (${device.deviceSerial}) is not configured correctly and will be skipped: ${error}`);
          continue;
        }
      }

      // Check if this is a dual camera
      const isDualCamera = deviceType === DeviceTypes.IPC && (deviceConfig as CameraConfig).dualCamera;

      if (isDualCamera) {
        // Create two separate camera accessories for dual camera devices
        const cameraChannels = [
          { suffix: '1', channelNumber: 101 },
          { suffix: '2', channelNumber: 201 },
        ];

        for (const { suffix, channelNumber } of cameraChannels) {
          const deviceSerial = `${device.deviceSerial}_${suffix}`;
          const deviceUuid = this.api.hap.uuid.generate(deviceSerial);
          const deviceName = `${device.name} - Camera ${suffix}`;
          const deviceData = { ...device };
          deviceData.channelNumber = channelNumber;

          const data = {
            UUID: deviceUuid,
            Serial: deviceSerial,
            Name: deviceName,
            Type: deviceType,
            Connection: devicesResponse.CONNECTION[device.deviceSerial],
            Status: devicesResponse.STATUS[device.deviceSerial],
            Switches: devicesResponse.SWITCH[device.deviceSerial],
            P2P: devicesResponse.P2P[device.deviceSerial],
            ResourceInfo: devicesResponse.resourceInfos.find((resource) => resource.deviceSerial === device.deviceSerial),
            DeviceInfo: deviceData,
            HBConfig: deviceConfig,
          } as DeviceData;

          devices.push(data);
        }
      } else {
        const data = {
          UUID: uuid,
          Serial: device.deviceSerial,
          Name: device.name,
          Type: deviceType,
          Connection: devicesResponse.CONNECTION[device.deviceSerial],
          Status: devicesResponse.STATUS[device.deviceSerial],
          Switches: devicesResponse.SWITCH[device.deviceSerial],
          P2P: devicesResponse.P2P[device.deviceSerial],
          ResourceInfo: devicesResponse.resourceInfos.find((resource) => resource.deviceSerial === device.deviceSerial),
          DeviceInfo: device,
          HBConfig: deviceConfig,
        } as DeviceData;

        devices.push(data);
      }
    };

    return devices;
  }

  /**
   * Validates camera configuration
   * @param camera - The camera configuration to validate
   * @returns Error message if validation fails, empty string if valid
   */
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
