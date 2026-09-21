import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, Service } from 'homebridge';
import { SmartPlug } from './accessories/smart-plug.js';
import { IPCamera } from './accessories/ip-camera.js';
import { SecuritySystemAccessory } from './accessories/security-system.js';
import { CameraMotionSensor } from './accessories/camera-motion-sensor.js';
import { EzvizMqttClient } from './utils/mqtt-client.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { EZVIZAPI } from './api/ezviz-api.js';
import { isRetryableError } from './api/ezviz-requests.js';
import { EZVIZConfig, CameraConfig } from './types/config.js';
import { Credentials } from './types/login.js';
import { DeviceTypes, CAMERA_DEVICE_TYPES } from './utils/enums.js';
import { ListDevicesResponse } from './types/devices.js';
import { DeviceData, AlarmSnapshot } from './types/data.js';

/**
 * EZVIZ Platform for Homebridge
 * Handles device discovery, authentication, and accessory management
 */
export class EZVIZPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  private readonly motionSensors: Map<string, CameraMotionSensor[]> = new Map();
  private mqttClient: EzvizMqttClient | null = null;
  private ezvizAPI: EZVIZAPI | null = null;
  // Latest alarm snapshot URL per device serial, used as a fast path for HomeKit
  // snapshot requests shortly after a motion event instead of a live RTSP grab.
  private readonly alarmSnapshots: Map<string, AlarmSnapshot> = new Map();

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
      this.ezvizAPI = ezvizAPI;
      const credentials = await this.authenticateWithRetry(ezvizAPI);
      
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
        await this.startMqtt(ezvizAPI);
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
   * @throws if the failure looks transient (network unreachable, DNS not resolving yet,
   *         etc.) so authenticateWithRetry can retry instead of giving up permanently
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
      if (isRetryableError(error)) {
        throw error;
      }
      this.log.error('Authentication failed:', error);
      return;
    }
  }

  /**
   * Wraps authenticate() with retry/backoff for startup, since a transient failure here
   * (most commonly: the host just rebooted after a power outage and its network isn't up
   * yet) would otherwise leave the plugin silently dead until Homebridge itself is
   * restarted again. Retries indefinitely on network-looking errors — the host may stay
   * offline for a while after a power event — but gives up immediately on a non-retryable
   * rejection (bad credentials, unsupported 2FA, missing config) since retrying can't fix
   * those.
   */
  async authenticateWithRetry(ezvizAPI: EZVIZAPI): Promise<Credentials | undefined> {
    const maxDelayMs = 5 * 60 * 1000;
    let delayMs = 15000;

    for (;;) {
      try {
        return await this.authenticate(ezvizAPI);
      } catch (error) {
        this.log.warn(
          `EZVIZ authentication failed, possibly because the network isn't up yet — retrying in ${Math.round(delayMs / 1000)}s:`,
          (error as Error).message ?? error,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, maxDelayMs);
      }
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
        let created: SmartPlug | IPCamera | undefined;
        if (existingAccessory) {
          this.log.debug(`Restoring existing ${device.Type} from cache: ${existingAccessory.displayName}`);
          existingAccessory.context.device = device;
          created = this.createAccessory(ezvizAPI, existingAccessory, device.Type);
        } else {
          this.log.info(`Adding new ${device.Type}: ${device.Name}`);
          const accessory = new this.api.platformAccessory(device.Name, device.UUID);
          accessory.context.device = device;
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          created = this.createAccessory(ezvizAPI, accessory, device.Type);
        }

        this.discoveredCacheUUIDs.push(device.UUID);

        if (CAMERA_DEVICE_TYPES.has(device.Type as DeviceTypes) && created instanceof IPCamera) {
          this.createCameraMotionSensor(ezvizAPI, device, created);
        }
      }

      // Create a single alarm mode (security system) accessory
      const alarmUuid = this.api.hap.uuid.generate('EZVIZ-AlarmMode');
      const existingAlarmAccessory = this.accessories.get(alarmUuid);

      if (existingAlarmAccessory) {
        this.log.debug('Restoring existing alarm mode accessory from cache');
        new SecuritySystemAccessory(ezvizAPI, this, existingAlarmAccessory);
      } else {
        this.log.info('Adding new alarm mode accessory');
        const alarmAccessory = new this.api.platformAccessory('Alarm Mode', alarmUuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [alarmAccessory]);
        new SecuritySystemAccessory(ezvizAPI, this, alarmAccessory);
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
   * @returns The created accessory wrapper, or undefined if the type is unsupported
   */
  private createAccessory(ezvizAPI: EZVIZAPI, accessory: PlatformAccessory, deviceType: string): SmartPlug | IPCamera | undefined {
    try {
      if (deviceType === DeviceTypes.Socket) {
        return new SmartPlug(ezvizAPI, this, accessory);
      } else if (CAMERA_DEVICE_TYPES.has(deviceType as DeviceTypes)) {
        return new IPCamera(ezvizAPI, this, accessory);
      } else {
        this.log.warn(`Unsupported device type: ${deviceType}`);
        return undefined;
      }
    } catch (error) {
      this.log.error(`Error creating accessory for ${accessory.displayName}:`, error);
      return undefined;
    }
  }

  /**
   * Wires a CameraMotionSensor onto the Motion Sensor service the camera's own
   * CameraController already created and linked via `sensors.motion` — see
   * IPCamera.getMotionService. This replaces the previous design of a separate
   * "X Motion" accessory: existing installs will see that standalone accessory
   * disappear and motion reappear as part of the camera accessory, which means
   * any room assignment or automation built on the old accessory must be redone.
   */
  private createCameraMotionSensor(ezvizAPI: EZVIZAPI, device: DeviceData, camera: IPCamera) {
    // Dual cameras carry a channel-suffixed accessory serial (ABC123_1), but MQTT push
    // and the alarm history both report the bare device serial, so events must be
    // matched on that.
    const serial = device.DeviceInfo.deviceSerial;
    const service = camera.getMotionService();
    const sensor = new CameraMotionSensor(ezvizAPI, this, service, serial, device.Name);

    const sensors = this.motionSensors.get(serial) ?? [];
    sensors.push(sensor);
    this.motionSensors.set(serial, sensors);
  }

  /**
   * Routes an MQTT push alarm to every motion sensor registered for that device.
   * A dual camera has one sensor per lens sharing a single device serial.
   */
  private handleMqttAlarm(serial: string): void {
    const sensors = this.motionSensors.get(serial);
    if (!sensors?.length) {
      this.log.debug(`MQTT: no motion sensor for serial=${serial}, ignoring`);
      return;
    }
    for (const sensor of sensors) {
      sensor.onMqttAlarm();
    }
    this.refreshAlarmSnapshot(serial);
  }

  /**
   * Fetches the freshest alarm snapshot for a device right after an MQTT push, so the
   * camera's next HomeKit snapshot request can serve it instead of a live RTSP grab.
   * Fire-and-forget: never blocks motion sensor triggering above.
   */
  private refreshAlarmSnapshot(serial: string): void {
    if (!this.ezvizAPI) {
      return;
    }
    this.ezvizAPI.getLatestAlarm(serial)
      .then((alarm) => {
        if (alarm?.picUrl) {
          this.updateAlarmSnapshot(serial, alarm.picUrl, alarm.time);
        }
      })
      .catch((error) => {
        this.log.debug(`Failed to refresh alarm snapshot for ${serial}:`, error);
      });
  }

  /**
   * Records the latest alarm snapshot URL for a device (called from the MQTT push
   * handler and from CameraMotionSensor's REST poll fallback). alarmTime is the alarm's
   * own occurrence time, not now — see AlarmSnapshot.
   */
  updateAlarmSnapshot(serial: string, url: string, alarmTime: number): void {
    this.alarmSnapshots.set(serial, { url, alarmTime });
  }

  /**
   * Returns the cached alarm snapshot for a device, if any, for StreamingDelegate's
   * snapshot-request fast path.
   */
  getAlarmSnapshot(serial: string): AlarmSnapshot | undefined {
    return this.alarmSnapshots.get(serial);
  }

  private async startMqtt(ezvizAPI: EZVIZAPI): Promise<void> {
    if (this.motionSensors.size === 0) {
      return;
    }
    try {
      const pushAddr = await ezvizAPI.getServiceUrls();
      const creds = this.config.credentials;
      if (!pushAddr || !creds?.username || !creds?.sessionId) {
        this.log.debug('MQTT: missing pushAddr or credentials, skipping');
        return;
      }
      this.mqttClient = new EzvizMqttClient(
        pushAddr,
        creds.sessionId,
        creds.username,
        (serial) => this.handleMqttAlarm(serial),
        this.log,
      );
      await this.mqttClient.connect();
      this.log.info('MQTT push connected — real-time alerts active, polling continues as fallback');
    } catch (error) {
      this.log.warn('MQTT push failed to connect, motion sensors will fall back to polling:', (error as Error).message);
    }
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
      } else if (CAMERA_DEVICE_TYPES.has(deviceType)) {
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
      const isDualCamera = deviceType === DeviceTypes.IPC && !!(deviceConfig as CameraConfig)?.dualCamera;

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
            Wifi: devicesResponse.WIFI?.[device.deviceSerial],
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
          Wifi: devicesResponse.WIFI?.[device.deviceSerial],
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
