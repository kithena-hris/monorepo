import { describe, expect, it } from 'vitest';

import { mayChangePhoto, PHOTO_MAX_BYTES, readPhoto } from './photo.js';

const ascii = (s: string) => Array.from(Buffer.from(s, 'latin1'));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

/** A PNG's shape: the signature, then chunks. The CRCs are not checked, so zeros do. */
function png(width: number, height: number, extra: readonly [string, number[]][] = []) {
  const chunk = (type: string, data: number[]) => [
    ...u32(data.length),
    ...ascii(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...extra.flatMap(([type, data]) => chunk(type, data)),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ]);
}

/** A JPEG's shape: SOI, segments, SOS and its entropy-coded data, EOI. */
function jpeg(width: number, height: number, segments: readonly [number, number[]][] = []) {
  const segment = (marker: number, data: number[]) => [
    0xff,
    marker,
    ...u16(data.length + 2),
    ...data,
  ];
  return new Uint8Array([
    0xff,
    0xd8,
    ...segment(0xe0, ascii('JFIF\0')),
    ...segments.flatMap(([m, d]) => segment(m, d)),
    ...segment(0xc0, [8, ...u16(height), ...u16(width), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    // Entropy-coded data: an escaped 0xff00 and a restart marker, both kept.
    0x12,
    0xff,
    0x00,
    0x34,
    0xff,
    0xd0,
    0x56,
    0xff,
    0xd9,
  ]);
}

const has = (bytes: Uint8Array, text: string) =>
  Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));

describe('readPhoto', () => {
  it('reads a PNG’s type and size from its header, whatever the file said it was', () => {
    const read = readPhoto(png(400, 300));
    expect(read.ok && read.value).toMatchObject({ mediaType: 'image/png', width: 400, height: 300 });
  });

  it('reads a JPEG’s type and size from its frame header', () => {
    const read = readPhoto(jpeg(640, 480));
    expect(read.ok && read.value).toMatchObject({
      mediaType: 'image/jpeg',
      width: 640,
      height: 480,
    });
  });

  it('drops a JPEG’s EXIF, XMP, IPTC and comments, where a phone keeps its GPS fix', () => {
    const read = readPhoto(
      jpeg(640, 480, [
        [0xe1, ascii('Exif\0\0GPS52.37N')],
        [0xed, ascii('Photoshop 3.0 IPTC')],
        [0xfe, ascii('a comment')],
        [0xe2, ascii('ICC_PROFILE\0')],
      ]),
    );
    if (!read.ok) throw new Error(read.error.message);
    const kept = read.value.bytes;
    expect(has(kept, 'GPS52')).toBe(false);
    expect(has(kept, 'IPTC')).toBe(false);
    expect(has(kept, 'a comment')).toBe(false);
    // Colour and the image itself stay.
    expect(has(kept, 'ICC_PROFILE')).toBe(true);
    expect(has(kept, 'JFIF')).toBe(true);
    expect(Array.from(kept.slice(-9))).toEqual([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9]);
  });

  it('drops a PNG’s text and EXIF chunks and keeps the image', () => {
    const read = readPhoto(
      png(200, 200, [
        ['tEXt', ascii('Author\0Somebody')],
        ['eXIf', ascii('MM\0*GPS')],
        ['iTXt', ascii('XML:com.adobe.xmp')],
        ['pHYs', [0, 0, 0, 1, 0, 0, 0, 1, 0]],
      ]),
    );
    if (!read.ok) throw new Error(read.error.message);
    expect(has(read.value.bytes, 'Somebody')).toBe(false);
    expect(has(read.value.bytes, 'GPS')).toBe(false);
    expect(has(read.value.bytes, 'adobe')).toBe(false);
    expect(has(read.value.bytes, 'pHYs')).toBe(true);
    expect(has(read.value.bytes, 'IDAT')).toBe(true);
    expect(has(read.value.bytes, 'IEND')).toBe(true);
  });

  it('refuses what is not a PNG or a JPEG, whatever its name', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    for (const bytes of [svg, html, new Uint8Array([0x47, 0x49, 0x46, 0x38])]) {
      const read = readPhoto(bytes);
      expect(read.ok ? null : read.error.code).toBe('PHOTO_TYPE');
    }
  });

  it('refuses a picture too small to be a face, or too large to be a photo', () => {
    expect(readPhoto(png(32, 32)).ok).toBe(false);
    expect(readPhoto(png(9000, 400)).ok).toBe(false);
    expect(readPhoto(new Uint8Array(PHOTO_MAX_BYTES + 1)).ok).toBe(false);
  });

  it('refuses a file that ends before its header does', () => {
    expect(readPhoto(png(200, 200).slice(0, 20)).ok).toBe(false);
    expect(readPhoto(jpeg(200, 200).slice(0, 12)).ok).toBe(false);
  });
});

describe('mayChangePhoto', () => {
  const nobody = {
    isSelf: false,
    isManager: false,
    isInManagerChain: false,
    isHr: false,
    isFinance: false,
    isAdmin: false,
  };

  it('is the person’s own, and HR’s', () => {
    expect(mayChangePhoto({ ...nobody, isSelf: true })).toBe(true);
    expect(mayChangePhoto({ ...nobody, isHr: true })).toBe(true);
  });

  it('is not a manager’s, nor an administrator’s', () => {
    expect(mayChangePhoto({ ...nobody, isManager: true, isInManagerChain: true })).toBe(false);
    expect(mayChangePhoto({ ...nobody, isAdmin: true, isFinance: true })).toBe(false);
  });
});
