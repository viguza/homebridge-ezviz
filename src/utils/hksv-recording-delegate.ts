import { spawn, ChildProcess } from 'child_process';
import {
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  H264Level,
  H264Profile,
  HDSProtocolSpecificErrorReason,
  Logging,
  RecordingPacket,
} from 'homebridge';
import pathToFfmpeg from 'ffmpeg-for-homebridge';
import { parseMp4Boxes } from './mp4-parser.js';
import { HksvPrebuffer } from './hksv-prebuffer.js';
import { redactCredentials } from './sanitize.js';

const DEFAULT_PREBUFFER_LENGTH_MS = 4000;

function sampleRateHz(rate: AudioRecordingSamplerate): number {
  switch (rate) {
  case AudioRecordingSamplerate.KHZ_8: return 8000;
  case AudioRecordingSamplerate.KHZ_16: return 16000;
  case AudioRecordingSamplerate.KHZ_24: return 24000;
  case AudioRecordingSamplerate.KHZ_32: return 32000;
  case AudioRecordingSamplerate.KHZ_44_1: return 44100;
  case AudioRecordingSamplerate.KHZ_48: return 48000;
  default: return 16000;
  }
}

/**
 * Builds the ffmpeg args that transcode `input` into the fragmented-mp4 output HKSV
 * expects, matching the H264/AAC parameters HomeKit selected for this recording.
 */
function buildRecordingArgs(input: string[], configuration: CameraRecordingConfiguration, includeAudio: boolean): string[] {
  const { parameters, resolution } = configuration.videoCodec;
  const profile = parameters.profile === H264Profile.HIGH ? 'high'
    : parameters.profile === H264Profile.MAIN ? 'main' : 'baseline';
  const level = parameters.level === H264Level.LEVEL4_0 ? '4.0'
    : parameters.level === H264Level.LEVEL3_2 ? '3.2' : '3.1';
  const fps = resolution[2];
  // HKSV fragments must start with a keyframe and run for mediaContainerConfiguration's
  // fragmentLength; the selected iFrameInterval is HomeKit's negotiated keyframe cadence
  // for that, so force real keyframes at that rate rather than relying on -g alone.
  const iFrameIntervalSeconds = Math.max(1, Math.round(parameters.iFrameInterval / 1000));

  const args = [
    ...input,
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-profile:v', profile,
    '-level:v', level,
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-b:v', `${parameters.bitRate}k`,
    '-bufsize', `${parameters.bitRate * 2}k`,
    '-maxrate', `${parameters.bitRate}k`,
    '-g', `${fps * iFrameIntervalSeconds}`,
    '-force_key_frames', `expr:gte(t,n_forced*${iFrameIntervalSeconds})`,
    '-r', `${fps}`,
  ];

  if (includeAudio) {
    const audioArgs = [
      '-c:a', 'aac',
      '-profile:a', configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC ? 'aac_low' : 'aac_eld',
      '-ar', `${sampleRateHz(configuration.audioCodec.samplerate)}`,
      '-b:a', `${configuration.audioCodec.bitrate}k`,
      '-ac', `${configuration.audioCodec.audioChannels ?? 1}`,
    ];
    args.splice(args.indexOf('-an'), 1, ...audioArgs);
  }

  args.push(
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  );

  return args;
}

/**
 * Implements HomeKit Secure Video recording for one camera: maintains a prebuffer
 * while recording is enabled, and on a HomeKit-triggered recording request transcodes
 * prebuffer + live video into the fragmented-mp4 packet stream HAP-NodeJS expects.
 */
export class HksvRecordingDelegate implements CameraRecordingDelegate {
  private configuration?: CameraRecordingConfiguration;
  private active = false;
  private readonly prebuffer: HksvPrebuffer;
  // Keyed by streamId: HomeKit can request a new recording stream before the previous
  // one's generator has finished draining, so a single shared field would get
  // overwritten and closeRecordingStream() would end up killing the wrong process,
  // orphaning the old one against the camera's RTSP connection indefinitely.
  private readonly processes = new Map<number, ChildProcess>();

  constructor(
    private readonly rtspUrl: string,
    private readonly cameraName: string,
    private readonly log: Logging,
    private readonly getRecordingAudioActive: () => boolean,
  ) {
    this.prebuffer = new HksvPrebuffer(rtspUrl, cameraName, log);
  }

  updateRecordingActive(active: boolean): void {
    this.log.debug(`HKSV recording ${active ? 'enabled' : 'disabled'} for ${this.cameraName}`);
    this.active = active;
    if (active) {
      this.prebuffer.start().catch((error) => {
        this.log.error(`Failed to start HKSV prebuffer for ${this.cameraName}:`, error);
      });
    } else {
      this.prebuffer.stop();
    }
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): void {
    this.configuration = configuration;
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
    const configuration = this.configuration;
    if (!configuration) {
      this.log.error(`HKSV recording requested for ${this.cameraName} with no selected configuration`);
      return;
    }

    const includeAudio = this.getRecordingAudioActive();
    const input = this.active
      ? await this.prebuffer.getRecordingInput(configuration.prebufferLength ?? DEFAULT_PREBUFFER_LENGTH_MS)
      : ['-rtsp_transport', 'tcp', '-i', this.rtspUrl];

    const videoProcessor = (pathToFfmpeg as unknown as string) || 'ffmpeg';
    const args = buildRecordingArgs(input, configuration, includeAudio);

    this.log.debug(`HKSV recording stream ${streamId} for ${this.cameraName} starting`);
    const cp = spawn(videoProcessor, args, { env: process.env });
    this.processes.set(streamId, cp);
    cp.stderr?.resume();
    cp.on('error', (error) => {
      this.log.error(`HKSV recording ffmpeg for ${this.cameraName} failed to start: ${redactCredentials((error as Error).message)}`);
    });

    let pendingInit: Buffer[] = [];
    let sawMoov = false;
    let moof: Buffer | null = null;

    try {
      if (!cp.stdout) {
        throw new Error('ffmpeg produced no stdout stream');
      }

      for await (const box of parseMp4Boxes(cp.stdout)) {
        if (!sawMoov) {
          pendingInit.push(box.header, box.data);
          if (box.type === 'moov') {
            sawMoov = true;
            yield { data: Buffer.concat(pendingInit), isLast: false };
            pendingInit = [];
          }
          continue;
        }

        if (box.type === 'moof') {
          moof = Buffer.concat([box.header, box.data]);
        } else if (box.type === 'mdat' && moof) {
          yield { data: Buffer.concat([moof, box.header, box.data]), isLast: false };
          moof = null;
        }
      }
    } catch (error) {
      this.log.debug(`HKSV recording stream ${streamId} for ${this.cameraName} ended: ${(error as Error).message}`);
    } finally {
      this.processes.delete(streamId);
      this.stopFfmpeg(cp);
    }
  }

  acknowledgeStream(streamId: number): void {
    this.log.debug(`HKSV recording stream ${streamId} for ${this.cameraName} acknowledged`);
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    this.log.debug(`HKSV recording stream ${streamId} for ${this.cameraName} closed (reason=${reason ?? 'connection closed'})`);
    const cp = this.processes.get(streamId);
    if (cp) {
      this.processes.delete(streamId);
      this.stopFfmpeg(cp);
    }
  }

  private stopFfmpeg(cp: ChildProcess): void {
    if (cp.exitCode !== null || cp.signalCode !== null) {
      return;
    }
    cp.kill('SIGTERM');
    // cp.killed only reflects that kill() was called, not that the process actually
    // exited, so it can't be used to decide whether to escalate — track real exit
    // instead, otherwise a process that ignores SIGTERM never gets force-killed.
    const forceKill = setTimeout(() => {
      if (cp.exitCode === null && cp.signalCode === null) {
        cp.kill('SIGKILL');
      }
    }, 2000);
    cp.once('exit', () => clearTimeout(forceKill));
  }
}
