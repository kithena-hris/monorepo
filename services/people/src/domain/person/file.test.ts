import { describe, expect, it } from 'vitest';

import { readFieldFile } from './file.js';

const pdf = new Uint8Array([...Buffer.from('%PDF-1.7\n1 0 obj\n'), 0x25, 0x25, 0x45, 0x4f, 0x46]);
// A 1×1 PNG's shape: signature, IHDR, IDAT, IEND (CRCs are not checked).
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, data: number[]) => [
  ...u32(data.length),
  ...Buffer.from(type, 'latin1'),
  ...data,
  0,
  0,
  0,
  0,
];
const png = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...chunk('IHDR', [...u32(1), ...u32(1), 8, 6, 0, 0, 0]),
  ...chunk('tEXt', [...Buffer.from('GPS 41.38,2.17')]),
  ...chunk('IDAT', [1, 2, 3]),
  ...chunk('IEND', []),
]);

const image = { kind: 'image', maxBytes: 5 * 1024 * 1024 } as const;
const document = { kind: 'document_ref', accepts: [], maxBytes: 10 * 1024 * 1024 } as const;

describe('readFieldFile', () => {
  it('takes an image field’s PNG, without what a camera wrote beside it', () => {
    const read = readFieldFile(png, image);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.mediaType).toBe('image/png');
      expect(Buffer.from(read.value.bytes).includes(Buffer.from('GPS'))).toBe(false);
    }
  });

  it('refuses a PDF where an image is asked for, and takes one as a document', () => {
    const asImage = readFieldFile(pdf, image);
    expect(asImage.ok).toBe(false);
    if (!asImage.ok) expect(asImage.error.code).toBe('FILE_TYPE');
    const asDocument = readFieldFile(pdf, document);
    expect(asDocument.ok && asDocument.value.mediaType).toBe('application/pdf');
  });

  it('keeps to what the field accepts, and to its size', () => {
    expect(readFieldFile(png, { ...document, accepts: ['application/pdf'] }).ok).toBe(false);
    const big = readFieldFile(pdf, { ...document, maxBytes: 4 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error.code).toBe('FILE_TOO_LARGE');
  });

  it('refuses what is not a file it can name: a script with a PDF’s name', () => {
    expect(readFieldFile(new Uint8Array(Buffer.from('<script>')), document).ok).toBe(false);
    expect(readFieldFile(new Uint8Array(), document).ok).toBe(false);
  });
});
