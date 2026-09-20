import { PlatformConfig } from 'homebridge';
import { Credentials } from './login.js';

export interface DeviceConfig {
  deviceName?: string;
  serial: string;
  code: string;
}

export type PlugConfig = DeviceConfig

export interface CameraConfig extends DeviceConfig {
  username: string;
  dualCamera?: boolean;
}

export interface EZVIZConfig extends PlatformConfig {
  region: number;
  email: string;
  password: string;
  credentials: Credentials;
  domain: string;
  cameras?: Array<CameraConfig>;
  plugs?: Array<PlugConfig>;
  /**
   * Enables HomeKit Secure Video recording for every camera. Off by default: it runs a
   * continuous background ffmpeg prebuffer process per camera and requires a HomeKit Hub
   * (Apple TV/HomePod) plus iCloud+ storage, so it isn't something every install wants.
   */
  enableHksv?: boolean;
}