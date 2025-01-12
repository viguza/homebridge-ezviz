import { execa, ResultPromise } from 'execa';
import { Logging, StreamRequestCallback } from 'homebridge';
import { StreamingDelegate } from './streaming-delegate.js';
import { Readable, Writable } from 'stream';
import pathToFfmpeg from 'ffmpeg-for-homebridge';

export async function doesFfmpegSupportCodec(codec: string, ffmpegPath: string): Promise<boolean> {
  if (!codec) {
    return false;
  }
  if (codec === 'copy') {
    return true;
  }
  const output = await execa(ffmpegPath, ['-codecs']);
  return output.stdout.includes(codec);
}

export async function getCodecsOutput(ffmpegPath: string): Promise<string> {
  const output = await execa(ffmpegPath, ['-codecs']);
  return output.stdout;
}

export async function getDefaultEncoder(ffmpegPath: string): Promise<string> {
  const output = await execa(ffmpegPath, ['-codecs']);
  const validEncoders = ['h264_omx', 'h264_videotoolbox'];
  validEncoders.forEach((encoder) => {
    if (output.stdout.includes(encoder)) {
      return encoder;
    }
  });
  return 'libx264';
}

export async function isFfmpegInstalled(ffmpegPath: string): Promise<boolean> {
  try {
    await execa(ffmpegPath, ['-codecs']);
    return true;
  } catch (_) {
    return false;
  }
}

export async function getSnapshot(url: string, customFfmpeg?: string): Promise<string> {
  const command = ['-i', url, '-vframes', '1', '-f', 'mjpeg', '-'];
  const videoProcessor = customFfmpeg || pathToFfmpeg as unknown as string || 'ffmpeg';
  const ff = await execa(videoProcessor, command, { env: process.env, encoding: undefined });
  return ff.stdout;
}

export class FfmpegProcess {
  private ff: ResultPromise | undefined;

  constructor(
    title: string,
    command: Array<string>,
    log: Logging,
    callback: StreamRequestCallback | undefined,
    delegate: StreamingDelegate,
    sessionId: string,
    ffmpegDebugOutput: boolean,
    customFfmpeg?: string,
  ) {
    let started = false;
    const controller = delegate.controller;
    const cmdOutput = `${title} command: ffmpeg ${command}`;
    if (ffmpegDebugOutput) {
      log.info(cmdOutput);
    } else {
      log.debug(cmdOutput);
    }

    const videoProcessor = customFfmpeg || pathToFfmpeg as unknown as string || 'ffmpeg';
    let lastOutput = '';
    try {
      this.ff = execa(videoProcessor, command, { env: process.env });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.ff.stderr?.on('data', (data: any) => {
        lastOutput = `${title}: ${String(data)}`;
        if (ffmpegDebugOutput) {
          log.info(lastOutput);
        } else {
          log.debug(lastOutput);
        }

        if (!started && lastOutput.includes('frame=')) {
          started = true;
          if (callback) {
            callback();
          }
        }
      });

      this.ff.on('exit', (code: number) => {
        if (code && code !== 0 && callback) {
          const lines = lastOutput.split('\n');
          let output = '';
          if (lines.length > 1) {
            output = lines[lines.length - 2];
            if (!output.includes('Exiting normally')) {
              log.error(`${title}: ${output}`);
            }
          }

          if (!started) {
            callback(new Error(output));
          }

          delegate.stopStream(sessionId);
          controller?.forceStopStreamingSession(sessionId);
        }
      });
    } catch (error) {
      log.error(`[${title}] Failed to start stream: ` + error);
      if (callback) {
        callback(new Error('ffmpeg process creation failed!'));
        delegate.stopStream(sessionId);
      }
    }
  }

  public stop(): void {
    this.ff?.stdin?.end();
    this.ff?.kill('SIGTERM');
  }

  public getStdin(): Writable | null | undefined {
    return this.ff?.stdin;
  }

  public getStdout(): Readable | null | undefined {
    return this.ff?.stdout;
  }
}