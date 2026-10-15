jest.mock('execa', () => jest.fn());

import { EventEmitter } from 'events';
import execa from 'execa';
import { Logging } from 'homebridge';
import { checkFfmpegAvailability, FfmpegProcess, getSnapshot, parseVideoCodec, probeVideoCodec } from '../../src/utils/ffmpeg';
import { StreamingDelegate } from '../../src/utils/streaming-delegate';

describe('checkFfmpegAvailability', () => {
  const createLog = () => ({ warn: jest.fn(), error: jest.fn() }) as unknown as Logging;

  beforeEach(() => {
    (execa as unknown as jest.Mock).mockReset();
  });

  test('stays quiet when the bundled ffmpeg is present', async () => {
    const log = createLog();
    await checkFfmpegAvailability(log, '/path/to/bundled/ffmpeg');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(execa).not.toHaveBeenCalled();
  });

  test('warns about the system-ffmpeg fallback when the bundled one is missing', async () => {
    (execa as unknown as jest.Mock).mockResolvedValue({ stdout: '' });
    const log = createLog();
    await checkFfmpegAvailability(log, null);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('--allow-scripts=ffmpeg-for-homebridge'));
    expect(log.error).not.toHaveBeenCalled();
  });

  test('logs an error with the fix when no ffmpeg is available at all', async () => {
    (execa as unknown as jest.Mock).mockRejectedValue(new Error('spawn ffmpeg ENOENT'));
    const log = createLog();
    await checkFfmpegAvailability(log, null);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Live view, snapshots and recording will not work'));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('--allow-scripts=ffmpeg-for-homebridge'));
  });
});

describe('FfmpegProcess', () => {
  test('redacts RTSP credentials from ffmpeg stderr in logs and in the error passed to HomeKit', () => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), stdout: new EventEmitter() });
    (execa as unknown as jest.Mock).mockReset();
    (execa as unknown as jest.Mock).mockReturnValue(child);
    const log = { debug: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as Logging;
    const delegate = { controller: undefined, stopStream: jest.fn() } as unknown as StreamingDelegate;
    const callback = jest.fn();

    new FfmpegProcess('Garage', ['-i', 'rtsp://admin:s3cr3t@1.2.3.4/'], log, callback, delegate, 'session', false);
    child.stderr.emit('data', 'Input #0, rtsp, from \'rtsp://admin:s3cr3t@1.2.3.4/\':\n');
    child.stderr.emit('data', 'rtsp://admin:s3cr3t@1.2.3.4/: Connection timed out\nExiting\n');
    child.emit('exit', 1, null);

    const logged = [log.debug, log.info, log.error]
      .flatMap((fn) => (fn as jest.Mock).mock.calls.flat())
      .join('\n');
    expect(logged).toContain('rtsp://***:***@1.2.3.4/');
    expect(logged).not.toContain('s3cr3t');
    expect(String(callback.mock.calls[0][0])).not.toContain('s3cr3t');
  });
});

describe('getSnapshot', () => {
  beforeEach(() => {
    (execa as unknown as jest.Mock).mockReset();
    (execa as unknown as jest.Mock).mockResolvedValue({ stdout: Buffer.from('jpeg-data') });
  });

  test('forces TCP transport and a socket timeout to avoid UDP packet-loss corruption', async () => {
    await getSnapshot('rtsp://example.test/Streaming/Channels/1/', 'ffmpeg');

    const [, command] = (execa as unknown as jest.Mock).mock.calls[0];
    expect(command).toEqual(expect.arrayContaining(['-rtsp_transport', 'tcp']));
    expect(command).toEqual(expect.arrayContaining(['-timeout', '5000000']));
    expect(command).toEqual(expect.arrayContaining(['-i', 'rtsp://example.test/Streaming/Channels/1/']));
  });
});

describe('parseVideoCodec', () => {
  test('reads HEVC from an EZVIZ C6N input summary (issue #51)', () => {
    const stderr = 'Input #0, rtsp, from \'rtsp://***:***@10.0.0.5:554/Streaming/Channels/1/\':\n' +
      '  Stream #0:0: Video: hevc (Main), yuvj420p(pc, bt709), 2880x1620, 15 tbr, 90k tbn\n';
    expect(parseVideoCodec(stderr)).toBe('hevc');
  });

  test('reads H264, including streams with an id suffix', () => {
    expect(parseVideoCodec('  Stream #0:0[0x1]: Video: h264 (High), yuv420p, 1920x1080')).toBe('h264');
  });

  test('ignores audio streams and returns null when there is no video stream', () => {
    expect(parseVideoCodec('  Stream #0:1: Audio: pcm_alaw, 8000 Hz, mono')).toBeNull();
    expect(parseVideoCodec('rtsp://***:***@10.0.0.5/: Connection timed out')).toBeNull();
  });
});

describe('probeVideoCodec', () => {
  beforeEach(() => {
    (execa as unknown as jest.Mock).mockReset();
  });

  test('opens the stream over TCP without failing on ffmpeg\'s no-output exit code', async () => {
    (execa as unknown as jest.Mock).mockResolvedValue({ exitCode: 1, stderr: '  Stream #0:0: Video: hevc (Main)' });

    await expect(probeVideoCodec('rtsp://example.test/', 'ffmpeg')).resolves.toBe('hevc');

    const [, command, options] = (execa as unknown as jest.Mock).mock.calls[0];
    expect(command).toEqual(expect.arrayContaining(['-rtsp_transport', 'tcp', '-i', 'rtsp://example.test/']));
    expect(options).toEqual(expect.objectContaining({ reject: false }));
  });
});
