import { EventEmitter } from 'events';
import { Server } from 'net';
import { PassThrough } from 'stream';
import { Logging } from 'homebridge';

jest.mock('child_process', () => ({
  spawn: jest.fn(() => Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
    kill: jest.fn(),
  })),
}));

import { spawn } from 'child_process';
import { HksvPrebuffer } from '../../src/utils/hksv-prebuffer';

describe('HksvPrebuffer', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('restarts with a fresh init segment after ffmpeg exits on its own', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const log = { debug: jest.fn(), error: jest.fn() } as unknown as Logging;
    const prebuffer = new HksvPrebuffer('rtsp://user:pass@camera/', 'Garage', log);
    const internals = prebuffer as unknown as { ftyp: unknown; moov: unknown };
    const spawnMock = spawn as unknown as jest.Mock;
    spawnMock.mockClear();

    try {
      await prebuffer.start();
      internals.ftyp = { type: 'ftyp' };
      internals.moov = { type: 'moov' };

      spawnMock.mock.results[0].value.emit('exit', 1, null);
      expect(internals.ftyp).toBeNull();
      expect(internals.moov).toBeNull();

      jest.advanceTimersByTime(10_000);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(spawnMock).toHaveBeenCalledTimes(2);
    } finally {
      prebuffer.stop();
    }
  });

  test('does not restart after stop()', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const log = { debug: jest.fn(), error: jest.fn() } as unknown as Logging;
    const prebuffer = new HksvPrebuffer('rtsp://user:pass@camera/', 'Garage', log);
    const spawnMock = spawn as unknown as jest.Mock;
    spawnMock.mockClear();

    await prebuffer.start();
    const cp = spawnMock.mock.results[0].value;
    prebuffer.stop();
    cp.emit('exit', null, 'SIGKILL');
    jest.advanceTimersByTime(10_000);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test('a server error after listening is logged instead of crashing the process', async () => {
    const log = { debug: jest.fn(), error: jest.fn() } as unknown as Logging;
    const prebuffer = new HksvPrebuffer('rtsp://user:pass@camera/', 'Garage', log);
    await prebuffer.start();

    try {
      const server = (prebuffer as unknown as { server: Server }).server;
      expect(() => server.emit('error', new Error('accept EMFILE'))).not.toThrow();
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('accept EMFILE'));
    } finally {
      prebuffer.stop();
    }
  });
});
