import { DeviceConfig } from './config.js';
import { ConnectionInfo, DeviceStatus, SwitchItem, P2PItem, ResourceInfo, DeviceInfo } from './devices.js';

export interface DeviceData {
  Connection: ConnectionInfo;
  Status: DeviceStatus;
  Switches: SwitchItem[];
  P2P: P2PItem[];
  ResourceInfo: ResourceInfo;
  DeviceInfo: DeviceInfo;
  HBConfig?: DeviceConfig;
}