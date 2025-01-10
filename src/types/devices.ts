export interface ConnectionInfo {
  localIp: string;
  netIp: string;
  localRtspPort: number;
  netRtspPort: number;
  localCmdPort: number;
  netCmdPort: number;
  localStreamPort: number;
  netHttpPort: number;
  localHttpPort: number;
  netStreamPort: number;
  netType: number;
  wanIp: string;
  upnp: boolean;
}

interface Connection {
  [deviceSerial: string]: ConnectionInfo;
}

interface StatusOptionals {
  [key: string]: string;
}

export interface DeviceStatus {
  diskNum: number;
  diskState: string;
  globalStatus: number;
  pirStatus: number;
  isEncrypt: number;
  encryptPwd: string;
  upgradeAvailable: number;
  upgradeProcess: number;
  upgradeStatus: number;
  alarmSoundMode: number;
  cloudType: number;
  diskStatus: string;
  privacyStatus: number;
  optionals: StatusOptionals;
}

interface Status {
  [deviceSerial: string]: DeviceStatus;
}

interface Meta {
  code: number;
  message: string;
}

export interface SwitchItem {
  deviceSerial: string;
  channelNo: number;
  type: number;
  enable: boolean;
}

export interface P2PItem {
  ip: string;
  port: number;
}

interface Switch {
  [deviceSerial: string]: SwitchItem[];
}

interface P2P {
  [deviceSerial: string]: P2PItem[];
}

export interface ResourceInfo {
  resourceId: string;
  resourceName: string;
  deviceSerial: string;
  superDeviceSerial: string;
  localIndex: string;
  shareType: number;
  permission: number;
  resourceType: number;
  resourceCover: string;
  isShow: number;
  videoLevel: number;
  streamBizUrl: string;
  groupId: number;
  customSetTag: number;
  resourceIdentifier: string;
  resourceCategory: string;
  conceal: number;
  globalState: number;
  child: boolean;
}

export interface DeviceInfo {
  name: string;
  deviceSerial: string;
  fullSerial: string;
  deviceType: string;
  devicePicPrefix: string;
  version: string;
  supportExt: string;
  status: number;
  userDeviceCreateTime: string;
  channelNumber: number;
  hik: boolean;
  deviceCategory: string;
  deviceSubCategory: string;
  ezDeviceCapability: string;
  customType: string;
  offlineTime: string;
  offlineNotify: number;
  instructionBook: string;
  authCode: string;
  userName: string;
  riskLevel: number;
  offlineTimestamp: number;
  mac: string;
  extStatus: number;
  classify: number;
  tags: null | string[];
}

export interface ListDevicesResponse {
  CONNECTION: Connection;
  STATUS: Status;
  meta: Meta;
  NODISTURB: Record<string, unknown>;
  DETECTOR: Record<string, unknown>;
  FEATURE: Record<string, unknown>;
  SWITCH: Switch;
  P2P: P2P;
  Page: {
      Offset: number;
      Limit: number;
      TotalResults: number;
      HasNext: boolean;
  };
  resourceInfos: ResourceInfo[];
  deviceInfos: DeviceInfo[];
}
