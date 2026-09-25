import execa from 'execa';
import { Logging, StreamRequestCallback } from 'homebridge';
import { StreamingDelegate } from './streaming-delegate.js';
import { Readable, Writable } from 'stream';
import pathToFfmpeg from 'ffmpeg-for-homebridge';
import { redactCredentials } from './sanitize.js';

export async function getCodecsOutput(ffmpegPath: string): Promise<string> {
  const output = await execa(ffmpegPath, ['-codecs']);
  return output.stdout;
}

export async function isFfmpegInstalled(ffmpegPath: string): Promise<boolean> {
  try {
    await execa(ffmpegPath, ['-codecs']);
    return true;
  } catch (_) {
    return false;
  }
}

// HomeKit abandons a snapshot request that takes too long and retries it, so an
// unbounded ffmpeg grab (e.g. a flaky RTSP connection that hangs) can leave a stale
// attempt to eventually resolve alongside a fresher retry, delivering the image twice.
const SNAPSHOT_TIMEOUT_MS = 8_000;

export async function getSnapshot(url: string, customFfmpeg?: string): Promise<Buffer> {
  const command = [
    // TCP avoids the packet loss/corruption UDP RTSP suffers on WiFi cameras (see
    // streaming-delegate.ts's live-view command for the same fix). -timeout bounds the
    // RTSP socket I/O itself (5s, in microseconds) so a dead/unreachable camera fails
    // with an ffmpeg error well before execa's own SNAPSHOT_TIMEOUT_MS hard-kills it.
    '-rtsp_transport', 'tcp',
    '-timeout', '5000000',
    '-i', url,
    '-vframes', '1',
    '-f', 'mjpeg',
    '-',
  ];
  const videoProcessor = customFfmpeg || pathToFfmpeg as unknown as string || 'ffmpeg';
  const ff = await execa(videoProcessor, command, { env: process.env, encoding: null, timeout: SNAPSHOT_TIMEOUT_MS });
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
    const cmdOutput = `${title} command: ffmpeg ${redactCredentials(command.join(' '))}`;
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
        // ffmpeg echoes its input URL (e.g. "Input #0, rtsp, from 'rtsp://user:pass@...'"
        // and in connection errors), and this text feeds both the logs and the error
        // passed to HomeKit's callback.
        const output = redactCredentials(String(data));
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