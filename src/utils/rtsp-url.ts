import { DeviceData } from '../types/data.js';
import { CameraConfig } from '../types/config.js';

export function getRtspUrl(deviceData: DeviceData): string {
  const cameraConfig = deviceData.HBConfig as CameraConfig;
  const ip = deviceData.Wifi?.address && deviceData.Wifi.address !== '0.0.0.0'
    ? deviceData.Wifi.address
    : deviceData.Connection.localIp;
  const port = deviceData.Connection.localRtspPort || 554;
  const channel = deviceData.DeviceInfo.channelNumber || 1;
  const username = encodeURIComponent(cameraConfig.username);
  const code = encodeURIComponent(cameraConfig.code);
  return `rtsp://${username}:${code}@${ip}:${port}/Streaming/Channels/${channel}/`;
}
