import { PlatformConfig } from 'homebridge';
import { Credentials } from './connection';

interface DeviceConfig {
  serial: string;
  code: string;
}

type Plug = DeviceConfig

interface Camera extends DeviceConfig {
  username: string;
}

export interface EZVIZConfig extends PlatformConfig {
  region: number;
  email: string;
  password: string;
  credentials: Credentials;
  domain: string;
  cameras?: Array<Camera>;
  plugs?: Array<Plug>;
}