import type { Readable } from 'stream';

export interface Mp4Box {
  header: Buffer;
  length: number;
  type: string;
  data: Buffer;
}

/**
 * Reads exactly `length` bytes from a Readable, waiting for more data to
 * arrive if necessary. Node's `stream.read(n)` returns null instead of
 * blocking when fewer than `n` bytes are currently buffered.
 */
function readExact(readable: Readable, length: number): Promise<Buffer> {
  if (length === 0) {
    return Promise.resolve(Buffer.alloc(0));
  }

  // Once a stream has ended, read(n) returns whatever's left in the buffer even if
  // shorter than n (rather than null), since it knows no more data is coming — so a
  // truthy return here isn't proof we got the full amount; the length must be checked.
  const immediate = readable.read(length) as Buffer | null;
  if (immediate && immediate.length === length) {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve, reject) => {
    // The three listeners need to remove each other on the way out, which is a
    // genuine reference cycle with no forward-reference-free declaration order for
    // plain identifiers. Routing through properties of an already-declared object
    // sidesteps that — no-use-before-define tracks variable bindings, not property
    // names, so `handlers.onEnd` isn't flagged even though `onEnd` is assigned later.
    const handlers: {
      onReadable?: () => void;
      onEnd?: () => void;
      onError?: (error: Error) => void;
    } = {};

    const cleanup = () => {
      readable.removeListener('readable', handlers.onReadable!);
      readable.removeListener('end', handlers.onEnd!);
      readable.removeListener('error', handlers.onError!);
    };

    handlers.onReadable = () => {
      const chunk = readable.read(length) as Buffer | null;
      if (chunk && chunk.length === length) {
        cleanup();
        resolve(chunk);
      }
    };
    handlers.onEnd = () => {
      cleanup();
      reject(new Error(`stream ended before ${length} bytes were available`));
    };
    handlers.onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    readable.on('readable', handlers.onReadable);
    readable.on('end', handlers.onEnd);
    readable.on('error', handlers.onError);
  });
}

/**
 * Parses a stream of fragmented-MP4 (ISO BMFF) boxes: a big-endian 4-byte size
 * (including the 8-byte header itself) followed by a 4-byte ASCII type, then
 * `size - 8` bytes of payload. Runs until the stream ends or errors.
 *
 * Doesn't handle the rare 64-bit extended-size variant (32-bit size field == 1,
 * with the real size in the next 8 bytes) — ffmpeg's fragmented-mp4 muxer never
 * emits it for the box types HKSV cares about (ftyp/moov/moof/mdat), which all
 * comfortably fit a 32-bit length.
 */
export async function* parseMp4Boxes(readable: Readable): AsyncGenerator<Mp4Box> {
  while (true) {
    const header = await readExact(readable, 8);
    const length = header.readUInt32BE(0) - 8;
    const type = header.subarray(4).toString('latin1');
    const data = await readExact(readable, length);
    yield { header, length, type, data };
  }
}
