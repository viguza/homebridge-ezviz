import { DeviceConfig } from './config.js';
import { ConnectionInfo, WifiInfo, DeviceStatus, SwitchItem, P2PItem, ResourceInfo, DeviceInfo } from './devices.js';

export interface AlarmSnapshot {
  url: string;
  // The alarm's own occurrence time (EZVIZ's alarmStartTime), not when we cached the
  // URL — the REST poll re-caches the same alarm every 30s even when nothing new has
  // happened, so caching the fetch time would keep resetting the freshness clock.
  alarmTime: number;
}

export interface DeviceData {
  UUID: string;
  Serial: string;
  Name: string;
  Type: string;
  Connection?: ConnectionInfo;
  Wifi?: WifiInfo;
  Status: DeviceStatus;
  Switches?: SwitchItem[];
  P2P: P2PItem[];
  ResourceInfo: ResourceInfo;
  DeviceInfo: DeviceInfo;
  HBConfig?: DeviceConfig;
}