jest.mock('execa', () => jest.fn());

import execa from 'execa';
import { getSnapshot } from '../../src/utils/ffmpeg';

describe('getSnapshot', () => {
  beforeEach(() => {
    (execa as unknown as jest.Mock).mockReset();
    (execa as unknown as jest.Mock).mockResolvedValue({ stdout: Buffer.from('jpeg-data') });
  });

  test('forces TCP transport and a socket timeout to avoid UDP packet-loss corruption', async () => {
    await getSnapshot('rtsp://example.test/Streaming/Channels/1/', 'ffmpeg');

    const [, command] = (execa as unknown as jest.Mock).mock.calls[0];
    expect(command).toEqual(expect.arrayContaining(['-rtsp_transport', 'tcp']));
    expect(command).toEqual(expect.arrayContaining(['-timeout', '5000000']));
    expect(command).toEqual(expect.arrayContaining(['-i', 'rtsp://example.test/Streaming/Channels/1/']));
  });
});
