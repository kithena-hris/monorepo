import { deflateSync } from 'node:zlib';

/**
 * Sample photos for the local seed: a head-and-shoulders silhouette in flat
 * colours, drawn here, pixel by pixel, into a PNG.
 *
 * Not a face and not anybody's: geometry, deterministic from the index, so
 * the seed needs no download, no licence and no binary in the repository, and
 * a re-seed draws the same picture. Local only — nothing but `seed-local.ts`
 * imports this.
 */

const SIZE = 256;
/** Samples per pixel edge: 4×4, so the curves are smooth rather than stepped. */
const SS = 4;

type Rgb = readonly [number, number, number];

const BACKGROUNDS: readonly Rgb[] = [
  [219, 234, 254],
  [220, 252, 231],
  [254, 243, 199],
  [252, 231, 243],
  [237, 233, 254],
  [204, 251, 241],
  [255, 237, 213],
  [226, 232, 240],
];
const SKIN: readonly Rgb[] = [
  [241, 194, 158],
  [198, 134, 94],
  [224, 172, 128],
  [141, 85, 54],
  [255, 219, 180],
  [170, 110, 75],
];
const HAIR: readonly Rgb[] = [
  [44, 34, 30],
  [110, 72, 42],
  [196, 160, 94],
  [86, 86, 90],
  [150, 60, 35],
];
const CLOTHES: readonly Rgb[] = [
  [37, 99, 235],
  [5, 150, 105],
  [217, 119, 6],
  [190, 24, 93],
  [109, 40, 217],
  [15, 118, 110],
  [71, 85, 105],
];

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;

/** Which part of the picture a point is in, front to back. */
function part(x: number, y: number, long: boolean): 'hair' | 'skin' | 'clothes' | null {
  const inHead = (x - 128) ** 2 / 46 ** 2 + (y - 108) ** 2 / 54 ** 2 <= 1;
  // Hair: a cap over the top of the head, and down the sides when long.
  const inCap = (x - 128) ** 2 / 52 ** 2 + (y - 96) ** 2 / 54 ** 2 <= 1 && y < 96;
  const inLong = long && Math.abs(x - 128) <= 56 && y >= 90 && y <= 170 && Math.abs(x - 128) >= 40;
  const inNeck = Math.abs(x - 128) <= 17 && y >= 150 && y <= 185;
  const inShoulders = (x - 128) ** 2 / 98 ** 2 + (y - 262) ** 2 / 86 ** 2 <= 1;
  if (inCap || inLong) return 'hair';
  if (inHead || inNeck) return 'skin';
  if (inShoulders) return 'clothes';
  return null;
}

/** The PNG for sample person `index`. */
export function samplePhoto(index: number): Uint8Array {
  const colours = {
    background: pick(BACKGROUNDS, index),
    skin: pick(SKIN, index * 5 + 1),
    hair: pick(HAIR, index * 3),
    clothes: pick(CLOTHES, index * 2 + 1),
  };
  const long = index % 3 === 1;
  // Each row starts with its filter byte (0: none).
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 3 + 1)] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const at = part(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, long);
          const c = at === null ? colours.background : colours[at];
          sum[0] = (sum[0] ?? 0) + c[0];
          sum[1] = (sum[1] ?? 0) + c[1];
          sum[2] = (sum[2] ?? 0) + c[2];
        }
      }
      const o = y * (SIZE * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k += 1) raw[o + k] = Math.round((sum[k] ?? 0) / (SS * SS));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, no filter, no interlace
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
