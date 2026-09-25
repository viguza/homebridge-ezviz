import { PassThrough } from 'stream';
import { parseMp4Boxes } from '../../src/utils/mp4-parser';

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

async function collect<T>(iterable: AsyncGenerator<T>, count: number): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
    if (results.length === count) {
      break;
    }
  }
  return results;
}

describe('parseMp4Boxes', () => {
  test.each([0, 1, 7])('fails instead of stalling on an unsupported box size of %i', async (size) => {
    const stream = new PassThrough();
    const header = Buffer.alloc(8);
    header.writeUInt32BE(size, 0);
    header.write('mdat', 4, 'latin1');
    stream.write(header);

    await expect(parseMp4Boxes(stream).next()).rejects.toThrow(`unsupported MP4 box size ${size} for 'mdat'`);
  });

  test('parses a single box written all at once', async () => {
    const stream = new PassThrough();
    const payload = Buffer.from('hello');
    stream.write(box('ftyp', payload));

    const [parsed] = await collect(parseMp4Boxes(stream), 1);

    expect(parsed.type).toBe('ftyp');
    expect(parsed.length).toBe(payload.length);
    expect(parsed.data).toEqual(payload);
    expect(parsed.header.length).toBe(8);
  });

  test('parses multiple sequential boxes in order', async () => {
    const stream = new PassThrough();
    stream.write(box('moof', Buffer.from('AA')));
    stream.write(box('mdat', Buffer.from('BBBB')));

    const [first, second] = await collect(parseMp4Boxes(stream), 2);

    expect(first.type).toBe('moof');
    expect(first.data.toString()).toBe('AA');
    expect(second.type).toBe('mdat');
    expect(second.data.toString()).toBe('BBBB');
  });

  test('reassembles a box whose bytes arrive in separate chunks, split mid-header and mid-payload', async () => {
    const stream = new PassThrough();
    const whole = box('moov', Buffer.from('0123456789'));

    const resultPromise = collect(parseMp4Boxes(stream), 1);

    // Split awkwardly: 3 bytes into the header, rest of header + partial payload, then the tail.
    stream.write(whole.subarray(0, 3));
    await new Promise((resolve) => setImmediate(resolve));
    stream.write(whole.subarray(3, 12));
    await new Promise((resolve) => setImmediate(resolve));
    stream.write(whole.subarray(12));

    const [parsed] = await resultPromise;
    expect(parsed.type).toBe('moov');
    expect(parsed.data.toString()).toBe('0123456789');
  });

  test('handles a zero-length payload box', async () => {
    const stream = new PassThrough();
    stream.write(box('free', Buffer.alloc(0)));

    const [parsed] = await collect(parseMp4Boxes(stream), 1);

    expect(parsed.type).toBe('free');
    expect(parsed.length).toBe(0);
    expect(parsed.data).toEqual(Buffer.alloc(0));
  });

  test('rejects when the stream ends mid-box', async () => {
    const stream = new PassThrough();
    const whole = box('mdat', Buffer.from('incomplete-payload'));
    stream.write(whole.subarray(0, 10));
    stream.end();

    const generator = parseMp4Boxes(stream);
    await expect(generator.next()).rejects.toThrow(/stream ended/);
  });
});
