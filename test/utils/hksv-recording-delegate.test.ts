import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import {
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
  CameraRecordingConfiguration,
  H264Level,
  H264Profile,
  Logging,
} from 'homebridge';

class FakeChildProcess extends EventEmitter {
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdout = new PassThrough();
  stderr = new PassThrough();

  kill = jest.fn(() => {
    // Mirrors real Node behavior: `killed` flips true as soon as kill() is called,
    // not when the process actually exits.
    this.killed = true;
    return true;
  });

  simulateExit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

const spawnedProcesses: FakeChildProcess[] = [];

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('../../src/utils/mp4-parser', () => ({
  // Never yields or completes on its own for these tests — we only inspect state
  // reached synchronously before this suspension point, then clean up via .return().
  // eslint-disable-next-line require-yield -- intentionally never yields for these tests
  parseMp4Boxes: jest.fn(async function* () {
    await new Promise(() => {});
  }),
}));

import { spawn } from 'child_process';
import { HksvRecordingDelegate } from '../../src/utils/hksv-recording-delegate';

const testConfiguration: CameraRecordingConfiguration = {
  prebufferLength: 4000,
  eventTriggerTypes: [],
  mediaContainerConfiguration: {} as CameraRecordingConfiguration['mediaContainerConfiguration'],
  videoCodec: {
    type: 0, // VideoCodecType.H264 — not re-exported by the `homebridge` package; it's the only member
    parameters: {
      profile: H264Profile.MAIN,
      level: H264Level.LEVEL3_1,
      bitRate: 2000,
      iFrameInterval: 4000,
    },
    resolution: [1920, 1080, 30],
  },
  audioCodec: {
    type: AudioRecordingCodecType.AAC_LC,
    samplerate: AudioRecordingSamplerate.KHZ_16,
    bitrate: 32,
    audioChannels: 1,
  },
};

function createLogger(): Logging {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  } as unknown as Logging;
}

describe('HksvRecordingDelegate', () => {
  beforeEach(() => {
    spawnedProcesses.length = 0;
    (spawn as unknown as jest.Mock).mockReset();
    (spawn as unknown as jest.Mock).mockImplementation(() => {
      const cp = new FakeChildProcess();
      spawnedProcesses.push(cp);
      return cp;
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function startStream(delegate: HksvRecordingDelegate, streamId: number) {
    const generator = delegate.handleRecordingStreamRequest(streamId);
    // Drives the generator up to (but not past) the point where it suspends inside
    // the mocked parseMp4Boxes — spawn() and the process-tracking bookkeeping run
    // synchronously before that suspension, so this is enough to observe them.
    generator.next();
    return generator;
  }

  test('closeRecordingStream kills only the process belonging to its own streamId', () => {
    const delegate = new HksvRecordingDelegate('rtsp://user:pass@camera/Streaming/Channels/1/', 'Garage', createLogger(), () => false);
    delegate.updateRecordingConfiguration(testConfiguration);

    const gen1 = startStream(delegate, 1);
    const gen2 = startStream(delegate, 2);

    expect(spawnedProcesses).toHaveLength(2);
    const [cp1, cp2] = spawnedProcesses;

    delegate.closeRecordingStream(1, undefined);

    expect(cp1.kill).toHaveBeenCalledWith('SIGTERM');
    expect(cp2.kill).not.toHaveBeenCalled();

    // Cleanup: unwind the still-suspended generators so nothing leaks between tests.
    gen1.return(undefined);
    gen2.return(undefined);
    cp2.simulateExit();
  });

  test('escalates to SIGKILL if the process ignores SIGTERM, tracking real exit rather than kill() having been called', () => {
    const delegate = new HksvRecordingDelegate('rtsp://user:pass@camera/Streaming/Channels/1/', 'Garage', createLogger(), () => false);
    delegate.updateRecordingConfiguration(testConfiguration);

    const gen = startStream(delegate, 1);
    const [cp] = spawnedProcesses;

    delegate.closeRecordingStream(1, undefined);
    expect(cp.kill).toHaveBeenCalledWith('SIGTERM');
    // Real Node sets `killed` synchronously on kill(), well before the process exits.
    expect(cp.killed).toBe(true);

    jest.advanceTimersByTime(2000);

    expect(cp.kill).toHaveBeenLastCalledWith('SIGKILL');

    gen.return(undefined);
  });

  test('does not escalate to SIGKILL once the process has actually exited', () => {
    const delegate = new HksvRecordingDelegate('rtsp://user:pass@camera/Streaming/Channels/1/', 'Garage', createLogger(), () => false);
    delegate.updateRecordingConfiguration(testConfiguration);

    const gen = startStream(delegate, 1);
    const [cp] = spawnedProcesses;

    delegate.closeRecordingStream(1, undefined);
    cp.simulateExit(0, null);

    jest.advanceTimersByTime(2000);

    expect(cp.kill).toHaveBeenCalledTimes(1);
    expect(cp.kill).not.toHaveBeenCalledWith('SIGKILL');

    gen.return(undefined);
  });
});
