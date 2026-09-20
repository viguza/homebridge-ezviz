import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createServer, Server } from 'net';
import { Logging } from 'homebridge';
import pathToFfmpeg from 'ffmpeg-for-homebridge';
import { Mp4Box, parseMp4Boxes } from './mp4-parser.js';

const PREBUFFER_DURATION_MS = 4000;
// A splice server that nobody ever connects to (e.g. HomeKit gave up before the
// recording ffmpeg process reached it) would otherwise listen forever.
const SPLICE_SERVER_TIMEOUT_MS = 60_000;

interface TimedBox {
  box: Mp4Box;
  time: number;
}

function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
      } else {
        reject(new Error('Failed to determine local port'));
      }
    });
  });
}

/**
 * Maintains a rolling few seconds of fragmented-mp4 video remuxed (not re-encoded —
 * cheap) from the camera's RTSP stream, so an HKSV recording can include the moments
 * just before the triggering motion event, not just what follows it.
 *
 * Runs one lightweight ffmpeg process per camera while HKSV recording is active.
 * getRecordingInput() splices the buffered boxes together with a live continuation
 * over a local TCP loopback connection and returns ffmpeg input args pointing at it,
 * so the actual (transcoding) per-recording ffmpeg process can read prebuffer + live
 * as one continuous source.
 */
export class HksvPrebuffer {
  private readonly events = new EventEmitter();
  private boxes: TimedBox[] = [];
  private ftyp: Mp4Box | null = null;
  private moov: Mp4Box | null = null;
  private process: ChildProcess | null = null;
  private server: Server | null = null;
  private starting: Promise<void> | null = null;

  constructor(
    private readonly rtspUrl: string,
    private readonly cameraName: string,
    private readonly log: Logging,
  ) {}

  async start(): Promise<void> {
    if (this.process) {
      return;
    }
    if (!this.starting) {
      this.starting = this.doStart().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  stop(): void {
    this.process?.kill('SIGKILL');
    this.process = null;
    this.server?.close();
    this.server = null;
    this.boxes = [];
    this.ftyp = null;
    this.moov = null;
  }

  /**
   * Returns ffmpeg input args (`-f mp4 -i tcp://...`) yielding the prebuffer's
   * content followed by a live continuation, for use as the *input* to a
   * separately spawned transcoding ffmpeg process.
   */
  async getRecordingInput(prebufferMs: number): Promise<string[]> {
    await this.start();

    const server = createServer((socket) => {
      server.close();
      const write = (box: Mp4Box) => socket.write(Buffer.concat([box.header, box.data]));

      if (this.ftyp) {
        write(this.ftyp);
      }
      if (this.moov) {
        write(this.moov);
      }

      const cutoff = Date.now() - prebufferMs;
      let needsMoof = true;
      for (const { box, time } of this.boxes) {
        if (time < cutoff) {
          continue;
        }
        // A fragment must start with a moof; skip a leading mdat left over from
        // before the cutoff so we never emit a dangling one with no header.
        if (needsMoof && box.type !== 'moof') {
          continue;
        }
        needsMoof = false;
        write(box);
      }

      const onBox = (box: Mp4Box) => write(box);
      this.events.on('box', onBox);

      const cleanup = () => {
        this.events.removeListener('box', onBox);
        socket.destroy();
      };
      socket.once('close', cleanup);
      socket.once('error', cleanup);
    });

    const port = await listenOnEphemeralPort(server);
    setTimeout(() => server.close(), SPLICE_SERVER_TIMEOUT_MS);

    return ['-f', 'mp4', '-i', `tcp://127.0.0.1:${port}`];
  }

  private async doStart(): Promise<void> {
    const server = createServer((socket) => {
      server.close();
      this.consume(socket).catch((error) => {
        this.log.debug(`HKSV prebuffer for ${this.cameraName} ended: ${(error as Error).message}`);
      });
    });
    const port = await listenOnEphemeralPort(server);
    this.server = server;

    const videoProcessor = (pathToFfmpeg as unknown as string) || 'ffmpeg';
    const args = [
      '-rtsp_transport', 'tcp',
      '-i', this.rtspUrl,
      '-an',
      '-c:v', 'copy',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      `tcp://127.0.0.1:${port}`,
    ];

    const cp = spawn(videoProcessor, args, { env: process.env });
    this.process = cp;
    // ffmpeg writes its normal progress output to stderr even on success; only the
    // process exit code indicates an actual failure.
    cp.stderr?.resume();
    cp.on('exit', (code, signal) => {
      this.log.debug(`HKSV prebuffer ffmpeg for ${this.cameraName} exited (code=${code}, signal=${signal})`);
      if (this.process === cp) {
        this.process = null;
      }
    });
    cp.on('error', (error) => {
      this.log.error(`HKSV prebuffer ffmpeg for ${this.cameraName} failed to start:`, error);
    });
  }

  private async consume(socket: NodeJS.ReadableStream): Promise<void> {
    for await (const box of parseMp4Boxes(socket as NodeJS.ReadableStream & import('stream').Readable)) {
      const now = Date.now();
      if (!this.ftyp) {
        this.ftyp = box;
      } else if (!this.moov) {
        this.moov = box;
      } else {
        this.boxes.push({ box, time: now });
        while (this.boxes.length && this.boxes[0].time < now - PREBUFFER_DURATION_MS) {
          this.boxes.shift();
        }
        this.events.emit('box', box);
      }
    }
  }
}
