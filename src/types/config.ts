import { PlatformConfig } from 'homebridge';
import { Credentials } from './login.js';

export interface DeviceConfig {
  serial: string;
  code: string;
}

export type PlugConfig = DeviceConfig

export interface CameraConfig extends DeviceConfig {
  username: string;
}

export interface EZVIZConfig extends PlatformConfig {
  region: number;
  email: string;
  password: string;
  credentials: Credentials;
  domain: string;
  cameras?: Array<CameraConfig>;
  plugs?: Array<PlugConfig>;
}