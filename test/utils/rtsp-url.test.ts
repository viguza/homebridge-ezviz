import { getCameraLocalIp, getRtspUrl } from '../../src/utils/rtsp-url';
import { DeviceData } from '../../src/types/data';

function deviceWith(username: string, code: string): DeviceData {
  return {
    HBConfig: { username, code },
    Connection: { localIp: '192.168.1.50', localRtspPort: 554 },
    DeviceInfo: { channelNumber: 1 },
  } as unknown as DeviceData;
}

describe('getRtspUrl', () => {
  test('builds the RTSP URL from the camera config and connection info', () => {
    expect(getRtspUrl(deviceWith('admin', 'ABCDEF'))).toBe('rtsp://admin:ABCDEF@192.168.1.50:554/Streaming/Channels/1/');
  });

  test('does not throw for a camera with no CONNECTION entry, and reports no local IP', () => {
    const device = { ...deviceWith('admin', 'ABCDEF'), Connection: undefined };
    expect(getCameraLocalIp(device)).toBeUndefined();
    expect(() => getRtspUrl(device)).not.toThrow();
  });

  test('prefers a valid WiFi address over the connection IP', () => {
    const device = { ...deviceWith('admin', 'ABCDEF'), Wifi: { address: '10.0.0.9' } } as DeviceData;
    expect(getCameraLocalIp(device)).toBe('10.0.0.9');
  });

  test('percent-encodes credentials so special characters do not break URL parsing', () => {
    const url = getRtspUrl(deviceWith('admin', 'ab@c/d:e'));
    expect(url).toBe('rtsp://admin:ab%40c%2Fd%3Ae@192.168.1.50:554/Streaming/Channels/1/');
    expect(new URL(url).hostname).toBe('192.168.1.50');
  });
});
