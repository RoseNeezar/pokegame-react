/**
 * A read-only ZIP reader, just large enough for the two PixelLab character packs.
 *
 * The character art arrives as `reference/characters/*.zip` and `reference/` is read-only input
 * that this pipeline must not modify or unpack in place. Extraction therefore happens at build
 * time into the gitignored cache. That leaves two options: shell out to `unzip` (not present on
 * every machine, and a build step that depends on an external binary is a build step that fails
 * on someone else's laptop) or read the container directly. Node ships `zlib.inflateRawSync`,
 * which is the only hard part of ZIP, so the container is ~60 lines.
 *
 * Deliberately partial: no encryption, no ZIP64, no multi-disk, no data descriptors. It reads
 * the central directory, and it throws rather than guess on anything it does not recognise.
 */
import { inflateRawSync } from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export function readZip(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEocd(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = new Map<string, Buffer>();
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== SIG_CENTRAL) {
      throw new Error(`readZip: bad central directory header at ${offset}`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);

    if (!name.endsWith('/')) {
      entries.set(name, readLocal(buffer, localOffset, method, compressedSize, uncompressedSize, name));
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readLocal(
  buffer: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  name: string,
): Buffer {
  if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
    throw new Error(`readZip: bad local header for "${name}"`);
  }
  const nameLen = buffer.readUInt16LE(localOffset + 26);
  const extraLen = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const raw = buffer.subarray(start, start + compressedSize);

  if (method === 0) return Buffer.from(raw);
  if (method === 8) {
    const out = inflateRawSync(raw);
    if (out.length !== uncompressedSize) {
      throw new Error(`readZip: "${name}" inflated to ${out.length}, expected ${uncompressedSize}`);
    }
    return out;
  }
  throw new Error(`readZip: "${name}" uses unsupported compression method ${method}`);
}

/** The EOCD sits at the end, after a variable-length comment, so it is found by scanning back. */
function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('readZip: no end-of-central-directory record found');
}
