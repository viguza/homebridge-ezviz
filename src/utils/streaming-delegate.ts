import axios from 'axios';
import {
  CameraController,
  CameraStreamingDelegate,
  HAP,
  Logging,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  StreamSessionIdentifier,
  VideoInfo,
  AudioInfo,
} from 'homebridge';
import { RtpSplitter, reservePorts } from './rtp.js';
import { SwitchTypes } from './enums.js';
import { FfmpegProcess, isFfmpegInstalled, getSnapshot, getCodecsOutput, probeVideoCodec } from './ffmpeg.js';
import { h264LevelName, h264ProfileName } from './h264.js';
import { readFile } from 'fs';
import { join } from 'path';
import pathToFfmpeg from 'ffmpeg-for-homebridge';
import { DeviceData, AlarmSnapshot } from '../types/data.js';
import { getRtspUrl } from './rtsp-url.js';
import { redactCredentials } from './sanitize.js';

// An alarm snapshot is only worth serving in place of a live grab while it's still
// representative of what the camera would show right now.
const ALARM_SNAPSHOT_MAX_AGE_MS = 20_000;
const ALARM_SNAPSHOT_FETCH_TIMEOUT_MS = 3_000;

type SessionInfo = {
  address: string; // address of the HAP controller

  videoPort: number;
  returnVideoPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
  videoSRTP: Buffer; // key and salt concatenated
  videoSSRC: number; // rtp synchronisation source

  audioPort: number;
  returnAudioPort: number;
  twoWayAudioPort: number;
  rtpSplitter: RtpSplitter;
  audioCryptoSuite: SRTPCryptoSuites;
  audioSRTP: Buffer;
  audioSSRC: number;
};

export class StreamingDelegate implements CameraStreamingDelegate {
  private readonly hap: HAP;
  private readonly log: Logging;
  private videoProcessor: string;
  private ffmpegInstalled = true;
  private ffmpegSupportsLibfdk_acc = true;
  private deviceData: DeviceData;
  private getAlarmSnapshot?: (serial: string) => AlarmSnapshot | undefined;
  // HomeKit live view only plays H264. Cameras that already send it are remuxed as-is;
  // anything else (e.g. H265 on newer EZVIZ models) has to be transcoded.
  private videoCodec: string | null = null;
  private videoCodecProbe: Promise<string | null> | null = null;
  private warnedAboutTranscoding = false;
  controller?: CameraController;

  // keep track of sessions
  private pendingSessions: Record<string, SessionInfo> = {};
  private ongoingSessions: Record<string, FfmpegProcess | undefined> = {};

  constructor(
    hap: HAP,
    deviceData: DeviceData,
    log: Logging,
    getAlarmSnapshot?: (serial: string) => AlarmSnapshot | undefined,
  ) {
    this.hap = hap;
    this.log = log;
    this.deviceData = deviceData;
    this.getAlarmSnapshot = getAlarmSnapshot;
    this.videoProcessor = pathToFfmpeg as unknown as string || 'ffmpeg';

    // Check if ffmpeg is installed
    isFfmpegInstalled(this.videoProcessor)
      .then((installed) => {
        this.ffmpegInstalled = installed;
      })
      .catch(() => {
        // skip
      });

    // Learn the camera's codec up front so the first live view doesn't wait on it.
    this.detectVideoCodec().catch(() => {
      // skip: prepareStream retries the probe
    });

    // Check which audio codecs this ffmpeg supports
    getCodecsOutput(this.videoProcessor)
      .then((output) => {
        this.ffmpegSupportsLibfdk_acc = output.includes('libfdk_aac');
      })
      .catch(() => {
        // skip
      });
  }

  /**
   * Resolves the camera's video codec, probing the RTSP stream once and caching the
   * answer. A failed probe isn't cached, so the next live view tries again.
   */
  private detectVideoCodec(): Promise<string | null> {
    if (this.videoCodec) {
      return Promise.resolve(this.videoCodec);
    }
    if (!this.videoCodecProbe) {
      this.videoCodecProbe = probeVideoCodec(getRtspUrl(this.deviceData), this.videoProcessor)
        .catch(() => null)
        .then((codec) => {
          this.videoCodecProbe = null;
          if (codec) {
            this.videoCodec = codec;
            this.log.debug(`${this.deviceData.Name} streams ${codec} video`);
          }
          return codec;
        });
    }
    return this.videoCodecProbe;
  }

  private getOfflineImage(callback: SnapshotRequestCallback): void {
    const log = this.log;
    readFile(join(__dirname, '../images/offline.jpg'), (err, data) => {
      if (err) {
        log.error(err.message);
        callback(err);
      } else {
        callback(undefined, data);
      }
    });
  }

  /**
   * Fetches the cached alarm snapshot for this device if one exists and is still fresh.
   * Returns null (rather than throwing) on any miss so callers can fall back to a live grab.
   */
  private async getCachedAlarmSnapshot(): Promise<Buffer | null> {
    if (!this.getAlarmSnapshot) {
      return null;
    }
    const cached = this.getAlarmSnapshot(this.deviceData.DeviceInfo.deviceSerial);
    if (!cached || Date.now() - cached.alarmTime > ALARM_SNAPSHOT_MAX_AGE_MS) {
      return null;
    }
    try {
      const response = await axios.get<ArrayBuffer>(cached.url, {
        responseType: 'arraybuffer',
        timeout: ALARM_SNAPSHOT_FETCH_TIMEOUT_MS,
      });
      return Buffer.from(response.data);
    } catch (error) {
      this.log.debug(`Alarm snapshot fetch failed for ${this.deviceData.Name}, falling back to live grab:`, error);
      return null;
    }
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    const startedAt = Date.now();
    this.log.debug(`Snapshot requested for ${this.deviceData.Name} (${request.width}x${request.height})`);

    const sleepSwitch = this.deviceData.Switches?.find((x) => x.type === SwitchTypes.Sleep);
    if (sleepSwitch?.enable) {
      this.getOfflineImage(callback);
      return;
    }

    this.getCachedAlarmSnapshot().then((cached) => {
      if (cached) {
        this.log.debug(`Snapshot for ${this.deviceData.Name} served from alarm cache in ${Date.now() - startedAt}ms`);
        callback(undefined, cached);
        return;
      }

      const url = getRtspUrl(this.deviceData);
      getSnapshot(url)
        .then((snapshot) => {
          this.log.debug(`Snapshot for ${this.deviceData.Name} served from live grab in ${Date.now() - startedAt}ms`);
          callback(undefined, snapshot);
        })
        .catch((error) => {
          const message = redactCredentials(error instanceof Error ? error.message : String(error));
          this.log.error(`Error fetching snapshot for ${this.deviceData.Name} after ${Date.now() - startedAt}ms: ${message}`);
          callback(new Error(message));
        });
    });
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    const sessionId: StreamSessionIdentifier = request.sessionID;
    const targetAddress = request.targetAddress;

    //video setup
    const video = request.video;
    const videoPort = video.port;
    const videoCryptoSuite = video.srtpCryptoSuite;
    const videoSrtpKey = video.srtp_key;
    const videoSrtpSalt = video.srtp_salt;
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

    //audio setup
    const audio = request.audio;
    const audioPort = audio.port;
    const audioCryptoSuite = video.srtpCryptoSuite;
    const audioSrtpKey = audio.srtp_key;
    const audioSrtpSalt = audio.srtp_salt;
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    // These four reservations are independent of each other (the "must be sequential"
    // constraint in reservePorts only applies to getting consecutive ports *within* a
    // single call, e.g. the twoWayAudioPort pair) — running them in parallel instead of
    // one after another shaves the sum of their round-trips off stream startup time.
    // The codec probe (normally already cached from startup) runs alongside them too.
    const [
      [returnVideoPort],
      [returnAudioPort],
      [twoWayAudioPort],
      [audioServerPort],
    ] = await Promise.all([
      reservePorts(),
      reservePorts(),
      reservePorts(2),
      reservePorts(),
      this.detectVideoCodec(),
    ]);

    const sessionInfo: SessionInfo = {
      address: targetAddress,

      videoPort: videoPort,
      returnVideoPort: returnVideoPort,
      videoCryptoSuite: videoCryptoSuite,
      videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
      videoSSRC: videoSSRC,

      audioPort: audioPort,
      returnAudioPort: returnAudioPort,
      twoWayAudioPort: twoWayAudioPort,
      rtpSplitter: new RtpSplitter(audioServerPort, returnAudioPort, twoWayAudioPort),
      audioCryptoSuite: audioCryptoSuite,
      audioSRTP: Buffer.concat([audioSrtpKey, audioSrtpSalt]),
      audioSSRC: audioSSRC,
    };

    const response: PrepareStreamResponse = {
      video: {
        port: returnVideoPort,
        ssrc: videoSSRC,

        srtp_key: videoSrtpKey,
        srtp_salt: videoSrtpSalt,
      },
      audio: {
        port: audioServerPort,
        ssrc: audioSSRC,

        srtp_key: audioSrtpKey,
        srtp_salt: audioSrtpSalt,
      },
    };
    this.pendingSessions[sessionId] = sessionInfo;
    callback(undefined, response);
  }

  private getCommand(videoInfo: VideoInfo, audioInfo: AudioInfo, sessionId: string): Array<string> {
    const sessionInfo = this.pendingSessions[sessionId];
    const videoPort = sessionInfo.videoPort;
    const returnVideoPort = sessionInfo.returnVideoPort;
    const videoSsrc = sessionInfo.videoSSRC;
    const videoSRTP = sessionInfo.videoSRTP.toString('base64');
    const address = sessionInfo.address;

    const videoPayloadType = videoInfo.pt;
    const mtu = videoInfo.mtu; // maximum transmission unit

    const audioPort = sessionInfo.audioPort;
    const returnAudioPort = sessionInfo.returnAudioPort;
    const audioSsrc = sessionInfo.audioSSRC;
    const audioSRTP = sessionInfo.audioSRTP.toString('base64');

    const videoCodecArgs = this.getVideoCodecArgs(videoInfo);

    const audioPayloadType = audioInfo.pt;
    const audioMaxBitrate = audioInfo.max_bit_rate;
    const sampleRate = audioInfo.sample_rate;

    let command = [
      '-rtsp_transport', 'tcp',
      // ffmpeg's defaults (5s analyzeduration, multi-MB probesize) spend real time
      // analyzing the input before producing any output, which is unnecessary for an
      // RTSP source whose codec is already known from its SDP. Trimmed, not zeroed —
      // an earlier attempt at -probesize 32 -analyzeduration 0 was too aggressive for a
      // live network source and broke stream start entirely rather than just speeding
      // it up. This is still a large reduction from the 5s/multi-MB defaults.
      '-probesize', '32768',
      '-analyzeduration', '500000',
      '-use_wallclock_as_timestamps', '1',
      '-i', getRtspUrl(this.deviceData),
      '-map', '0:0',
      ...videoCodecArgs,
      '-an',
      '-payload_type', videoPayloadType.toString(),
      '-ssrc', videoSsrc.toString(),
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', videoSRTP,
      `srtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${returnVideoPort}&pkt_size=${mtu}`,
    ];

    if (this.ffmpegSupportsLibfdk_acc) {
      const audioSwitch = this.deviceData.Switches?.find((x) => x.type === SwitchTypes.Audio);
      if (audioSwitch?.enable) {
        command = command.concat([
          '-map',
          '0:1',
          '-c:a',
          'libfdk_aac',
          '-profile:a',
          'aac_eld',
          '-ac',
          '1',
          '-vn',
          '-af',
          'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
          '-ar',
          `${sampleRate}k`,
          '-b:a',
          `${audioMaxBitrate}k`,
          '-flags',
          '+global_header',
          '-payload_type',
          audioPayloadType.toString(),
          '-ssrc',
          audioSsrc.toString(),
          '-f',
          'rtp',
          '-srtp_out_suite',
          'AES_CM_128_HMAC_SHA1_80',
          '-srtp_out_params',
          audioSRTP,
          `srtp://${address}:${audioPort}?rtcpport=${audioPort}&localrtcpport=${returnAudioPort}&pkt_size=188`,
        ]);
      }
    } else {
      this.log.error(
        'This version of FFMPEG does not support the audio codec \'libfdk_aac\'. ' +
        'You may need to recompile FFMPEG using \'--enable-libfdk_aac\' and restart homebridge.',
      );
    }

    const sleepSwitch = this.deviceData.Switches?.find((x) => x.type === SwitchTypes.Sleep);
    if (sleepSwitch?.enable) {
      command = [
        '-loop',
        '1',
        '-i',
        join(__dirname, '../images/offline.jpg'),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'stillimage',
        '-pix_fmt',
        'yuv420p',
        '-an',
        '-payload_type',
        videoPayloadType.toString(),
        '-ssrc',
        videoSsrc.toString(),
        '-f',
        'rtp',
        '-srtp_out_suite',
        'AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params',
        videoSRTP,
        `srtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${returnVideoPort}&pkt_size=${mtu}`,
      ];
    }

    return command;
  }

  private getVideoCodecArgs(videoInfo: VideoInfo): Array<string> {
    if (this.videoCodec === 'h264') {
      this.log.debug(`Live view for ${this.deviceData.Name}: passing H264 through unchanged`);
      return ['-c:v', 'copy', '-pix_fmt', 'yuv420p'];
    }

    if (this.videoCodec && !this.warnedAboutTranscoding) {
      this.warnedAboutTranscoding = true;
      this.log.warn(
        `${this.deviceData.Name} streams ${this.videoCodec.toUpperCase()} video, which HomeKit can't play, ` +
        'so live view is being converted to H264. This uses noticeably more CPU. If the EZVIZ app lets you ' +
        'switch this camera\'s video encoding to H.264, doing so avoids the conversion.',
      );
    }

    const { width, height, fps, max_bit_rate: bitrate } = videoInfo;
    this.log.debug(
      `Live view for ${this.deviceData.Name}: converting ${this.videoCodec ?? 'unknown codec'} ` +
      `to H264 ${width}x${height}@${fps}fps, ${bitrate}kbps`,
    );
    return [
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-profile:v', h264ProfileName(videoInfo.profile),
      '-level:v', h264LevelName(videoInfo.level),
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      // Fit within what HomeKit asked for (EZVIZ main streams can be 2K+), keeping aspect.
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-r', `${fps}`,
      '-b:v', `${bitrate}k`,
      '-bufsize', `${bitrate * 2}k`,
      '-maxrate', `${bitrate}k`,
    ];
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    const sessionId = request.sessionID;

    switch (request.type) {
    case StreamRequestTypes.START:
    { const video: VideoInfo = request.video;
      const audio: AudioInfo = request.audio;

      if (!this.ffmpegInstalled) {
        this.log.error('FFMPEG is not installed. Please install it and restart homebridge.');
        callback(new Error('FFmpeg not installed'));
        break;
      }

      const ffmpegCommand = this.getCommand(video, audio, sessionId);
      const ffmpeg = new FfmpegProcess(
        'STREAM',
        ffmpegCommand,
        this.log,
        callback,
        this,
        sessionId,
        false,
      );
      this.log.info(`Streaming started for ${this.deviceData.Name}`);
      this.ongoingSessions[sessionId] = ffmpeg;
      break; }
    case StreamRequestTypes.RECONFIGURE:
      // not implemented
      this.log.debug('(Not implemented) Received request to reconfigure to: ' + JSON.stringify(request.video));
      callback();
      break;
    case StreamRequestTypes.STOP:
      this.stopStream(sessionId);
      callback();
      break;
    }
  }

  public stopStream(sessionId: string): void {
    try {
      if (this.ongoingSessions[sessionId]) {
        const ffmpegVideoProcess = this.ongoingSessions[sessionId];
        ffmpegVideoProcess?.stop();
        this.log.info(`Streaming stopped for ${this.deviceData.Name}`);
      }

      const sessionInfo = this.pendingSessions[sessionId];
      if (sessionInfo) {
        sessionInfo.rtpSplitter.close();
      }

      delete this.pendingSessions[sessionId];
      delete this.ongoingSessions[sessionId];
    } catch (error) {
      this.log.error('Error occurred terminating the video process!', error);
    }
  }
}