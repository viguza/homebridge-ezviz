import { redactCredentials } from '../../src/utils/sanitize';

describe('redactCredentials', () => {
  test('masks username and password embedded in an RTSP URL', () => {
    const url = 'rtsp://admin:s3cr3t@192.168.1.172:554/Streaming/Channels/1/';
    expect(redactCredentials(url)).toBe('rtsp://***:***@192.168.1.172:554/Streaming/Channels/1/');
  });

  test('masks a credentialed URL embedded inside a full ffmpeg command line', () => {
    const command = '-rtsp_transport tcp -timeout 5000000 -i rtsp://admin:s3cr3t@192.168.1.172:554/Streaming/Channels/1/ -vframes 1 -f mjpeg -';
    expect(redactCredentials(command)).toBe(
      '-rtsp_transport tcp -timeout 5000000 -i rtsp://***:***@192.168.1.172:554/Streaming/Channels/1/ -vframes 1 -f mjpeg -',
    );
    expect(redactCredentials(command)).not.toContain('s3cr3t');
  });

  test('leaves a URL with no embedded credentials unchanged', () => {
    const url = 'rtsp://192.168.1.172:554/Streaming/Channels/1/';
    expect(redactCredentials(url)).toBe(url);
  });

  test('leaves plain text with no URL unchanged', () => {
    expect(redactCredentials('ffmpeg exited with code 1')).toBe('ffmpeg exited with code 1');
  });
});
