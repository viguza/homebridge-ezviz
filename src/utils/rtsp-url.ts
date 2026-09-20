import { DeviceData } from '../types/data.js';
import { CameraConfig } from '../types/config.js';

export function getRtspUrl(deviceData: DeviceData): string {
  const cameraConfig = deviceData.HBConfig as CameraConfig;
  const ip = deviceData.Wifi?.address && deviceData.Wifi.address !== '0.0.0.0'
    ? deviceData.Wifi.address
    : deviceData.Connection.localIp;
  const port = deviceData.Connection.localRtspPort || 554;
  const channel = deviceData.DeviceInfo.channelNumber || 1;
  return `rtsp://${cameraConfig.username}:${cameraConfig.code}@${ip}:${port}/Streaming/Channels/${channel}/`;
}
