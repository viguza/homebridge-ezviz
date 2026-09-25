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

import { HksvPrebuffer } from '../../src/utils/hksv-prebuffer';

describe('HksvPrebuffer', () => {
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
