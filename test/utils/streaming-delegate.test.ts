jest.mock('execa', () => jest.fn());
// rtp.ts pulls in the ESM-only get-port, and these tests don't need real sockets.
jest.mock('../../src/utils/rtp', () => ({
  reservePorts: async (count = 1) => Array.from({ length: count }, (_, i) => 40000 + i),
  RtpSplitter: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
}));

import execa from 'execa';
import { HAP, Logging, PrepareStreamRequest, VideoInfo, AudioInfo } from 'homebridge';
import { StreamingDelegate } from '../../src/utils/streaming-delegate';
import { DeviceData } from '../../src/types/data';

const device = {
  Name: 'Garage',
  HBConfig: { username: 'admin', code: 'ABCDEF' },
  Connection: { localIp: '192.168.1.50', localRtspPort: 554 },
  DeviceInfo: { channelNumber: 1, deviceSerial: 'SERIAL' },
} as unknown as DeviceData;

const hap = { CameraController: { generateSynchronisationSource: () => 1234 } } as unknown as HAP;

const prepareRequest = {
  sessionID: 'session',
  targetAddress: '10.0.0.2',
  video: { port: 50000, srtpCryptoSuite: 0, srtp_key: Buffer.alloc(16), srtp_salt: Buffer.alloc(14) },
  audio: { port: 50002, srtp_key: Buffer.alloc(16), srtp_salt: Buffer.alloc(14) },
} as unknown as PrepareStreamRequest;

const videoInfo = {
  pt: 99, mtu: 1378, width: 1920, height: 1080, fps: 30, max_bit_rate: 802, profile: 2, level: 2,
} as unknown as VideoInfo;
const audioInfo = { pt: 110, max_bit_rate: 24, sample_rate: 16 } as unknown as AudioInfo;

type Internals = { getCommand(video: VideoInfo, audio: AudioInfo, sessionId: string): string[] };

/** Fakes ffmpeg: `-codecs` for the capability checks, and the probe's input summary. */
function mockFfmpeg(probeStderr: string): void {
  (execa as unknown as jest.Mock).mockImplementation(async (_path: string, args: string[]) =>
    args.includes('-codecs') ? { stdout: '' } : { exitCode: 1, stderr: probeStderr });
}

async function streamCommand(log: Logging): Promise<string[]> {
  const delegate = new StreamingDelegate(hap, device, log);
  await delegate.prepareStream(prepareRequest, () => undefined);
  const command = (delegate as unknown as Internals).getCommand(videoInfo, audioInfo, 'session');
  delegate.stopStream('session');
  return command;
}

function videoArgs(command: string[]): string[] {
  return command.slice(command.indexOf('0:0') + 1, command.indexOf('-an'));
}

describe('StreamingDelegate live view codec', () => {
  const createLog = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logging;

  beforeEach(() => {
    (execa as unknown as jest.Mock).mockReset();
  });

  test('passes an H264 camera through unchanged', async () => {
    mockFfmpeg('  Stream #0:0: Video: h264 (Main), yuvj420p(pc, bt709), 1920x1080');
    const log = createLog();

    expect(videoArgs(await streamCommand(log))).toEqual(['-c:v', 'copy', '-pix_fmt', 'yuv420p']);
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('converts an H265 camera to the H264 stream HomeKit asked for (issue #51)', async () => {
    mockFfmpeg('  Stream #0:0: Video: hevc (Main), yuvj420p(pc, bt709), 2880x1620');
    const log = createLog();

    const args = videoArgs(await streamCommand(log));
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-pix_fmt', 'yuv420p']));
    expect(args).toEqual(expect.arrayContaining(['-profile:v', 'high', '-level:v', '4.0']));
    expect(args).toEqual(expect.arrayContaining(['-r', '30', '-b:v', '802k', '-maxrate', '802k']));
    expect(args).toEqual(expect.arrayContaining([
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2',
    ]));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('HEVC'));
  });

  test('warns about the conversion only once per camera', async () => {
    mockFfmpeg('  Stream #0:0: Video: hevc (Main)');
    const log = createLog();
    const delegate = new StreamingDelegate(hap, device, log);
    const internals = delegate as unknown as Internals;

    for (let i = 0; i < 2; i++) {
      await delegate.prepareStream(prepareRequest, () => undefined);
      internals.getCommand(videoInfo, audioInfo, 'session');
      delegate.stopStream('session');
    }

    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  test('converts when the codec could not be determined, and probes again next time', async () => {
    mockFfmpeg('rtsp://***:***@192.168.1.50/: Connection timed out');
    const log = createLog();
    const delegate = new StreamingDelegate(hap, device, log);

    await delegate.prepareStream(prepareRequest, () => undefined);
    const args = videoArgs((delegate as unknown as Internals).getCommand(videoInfo, audioInfo, 'session'));
    delegate.stopStream('session');
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264']));
    expect(log.warn).not.toHaveBeenCalled();

    mockFfmpeg('  Stream #0:0: Video: h264 (Main)');
    await delegate.prepareStream(prepareRequest, () => undefined);
    expect(videoArgs((delegate as unknown as Internals).getCommand(videoInfo, audioInfo, 'session')))
      .toEqual(['-c:v', 'copy', '-pix_fmt', 'yuv420p']);
    delegate.stopStream('session');
  });
});
