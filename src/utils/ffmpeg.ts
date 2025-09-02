import execa from 'execa';
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

export async function getSnapshot(url: string, customFfmpeg?: string): Promise<Buffer> {
  const command = ['-i', url, '-vframes', '1', '-f', 'mjpeg', '-'];
  const videoProcessor = customFfmpeg || pathToFfmpeg as unknown as string || 'ffmpeg';
  const ff = await execa(videoProcessor, command, { env: process.env, encoding: null });
  return ff.stdout;
}

export class FfmpegProcess {
  private ff: execa.ExecaChildProcess<string> | undefined;
  private killTimeout?: NodeJS.Timeout;
  private startTimeout?: NodeJS.Timeout;

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
    let startedCallback = false;
    const controller = delegate.controller;
    const cmdOutput = `${title} command: ffmpeg ${command.join(' ')}`;
    if (ffmpegDebugOutput) {
      log.info(cmdOutput);
    } else {
      log.debug(cmdOutput);
    }

    const videoProcessor = customFfmpeg || pathToFfmpeg as unknown as string || 'ffmpeg';
    let lastOutput = '';
    try {
      this.ff = execa(videoProcessor, command, { env: process.env });

      this.startTimeout = setTimeout(() => {
        if (!started && callback && !startedCallback) {
          started = true;
          startedCallback = true;
          log.debug(`${title}: Stream start timeout reached, calling callback`);
          callback();
        }
      }, 3000);

      this.ff.stderr?.on('data', (data) => {
        const output = String(data);
        lastOutput = `${title}: ${output}`;
        if (ffmpegDebugOutput) {
          log.info(lastOutput);
        } else {
          log.debug(lastOutput);
        }

        if (!started && (output.includes('frame=') || output.includes('fps=') || output.includes('size='))) {
          started = true;
          if (callback && !startedCallback) {
            startedCallback = true;
            if (this.startTimeout) {
              clearTimeout(this.startTimeout);
              this.startTimeout = undefined;
            }
            callback();
          }
        }
      });

      this.ff.stdout?.on('data', (data) => {
        if (ffmpegDebugOutput) {
          log.debug(`${title} stdout: ${String(data)}`);
        }
      });

      this.ff.on('exit', (code, signal) => {
        if (this.killTimeout) {
          clearTimeout(this.killTimeout);
          this.killTimeout = undefined;
        }
        if (this.startTimeout) {
          clearTimeout(this.startTimeout);
          this.startTimeout = undefined;
        }

        if (code !== null && code !== 0 && !signal) {
          const lines = lastOutput.split('\n');
          let output = '';
          if (lines.length > 1) {
            output = lines[lines.length - 2];
            if (!output.includes('Exiting normally') && !output.includes('SIGTERM')) {
              log.error(`${title} exited with error: ${output}`);
            }
          }

          if (!started && callback && !startedCallback) {
            startedCallback = true;
            callback(new Error(output || 'FFmpeg process failed to start'));
          }
        }

        delegate.stopStream(sessionId);
        controller?.forceStopStreamingSession(sessionId);
      });

      this.ff.on('error', (error) => {
        log.error(`${title} process error: ${error.message}`);
        if (callback && !startedCallback) {
          startedCallback = true;
          callback(new Error(`FFmpeg process error: ${error.message}`));
        }
        delegate.stopStream(sessionId);
        controller?.forceStopStreamingSession(sessionId);
      });
    } catch (error) {
      log.error(`[${title}] Failed to start stream: ` + error);
      if (callback && !startedCallback) {
        startedCallback = true;
        callback(new Error('ffmpeg process creation failed!'));
        delegate.stopStream(sessionId);
      }
    }
  }

  public stop(): void {
    if (!this.ff) {
      return;
    }

    try {
      this.ff.stdin?.end();
      this.ff.kill('SIGTERM');

      // Set a timeout to force kill if process doesn't terminate gracefully
      this.killTimeout = setTimeout(() => {
        this.ff?.kill('SIGKILL');
      }, 5000);
    } catch (error) {
      // Process might already be dead, ignore the error
    }
  }

  public getStdin(): Writable | null | undefined {
    return this.ff?.stdin;
  }

  public getStdout(): Readable | null | undefined {
    return this.ff?.stdout;
  }
}