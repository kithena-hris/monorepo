import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { ViewerRelations } from '../access/field-access.js';

/**
 * A person's photo: what one may be, and who may change it.
 *
 * The browser shrinks a picked image before it uploads it, so what arrives is
 * small; this decides whether it is a picture at all. The type is read from
 * the bytes — the file's name and its claimed type are the uploader's to say
 * and nobody's to trust — and only PNG and JPEG are photos: an SVG is a
 * document that can run script, and a format nothing here parses is one
 * nothing here can clean.
 *
 * Cleaning is dropping what a camera writes beside the picture: EXIF (where a
 * phone keeps the GPS fix of the employee's kitchen), XMP, IPTC and comments.
 * The picture's own bytes are copied untouched, so nothing is re-encoded and
 * nothing is lost.
 *
 * Pure: bytes in, bytes out.
 */

/** After the browser has shrunk it to a 512px square, a photo is a few tens of kB. */
export const PHOTO_MAX_BYTES = 512 * 1024;
/** Smaller is not a face; larger was not shrunk, and is not stored. */
export const PHOTO_MIN_EDGE = 64;
export const PHOTO_MAX_EDGE = 2048;

export type PhotoMediaType = 'image/png' | 'image/jpeg';

export interface Photo {
  readonly mediaType: PhotoMediaType;
  readonly width: number;
  readonly height: number;
  /** The file without its metadata. */
  readonly bytes: Uint8Array;
}

/** Their own, and HR's. A manager sees a photo and does not choose it. */
export function mayChangePhoto(relations: ViewerRelations): boolean {
  return relations.isSelf || relations.isHr;
}

const notAPhoto = () =>
  err(failure('PHOTO_TYPE', 'A photo is a PNG or a JPEG', ['file']));
const broken = () => err(failure('PHOTO_TYPE', 'This file is not a whole image', ['file']));

export function readPhoto(bytes: Uint8Array): Result<Photo> {
  if (bytes.byteLength > PHOTO_MAX_BYTES) {
    return err(failure('PHOTO_TOO_LARGE', 'A photo is at most 512 kB', ['file']));
  }
  const read = isPng(bytes) ? cleanPng(bytes) : isJpeg(bytes) ? cleanJpeg(bytes) : notAPhoto();
  if (!read.ok) return read;
  const { width, height } = read.value;
  if (Math.min(width, height) < PHOTO_MIN_EDGE || Math.max(width, height) > PHOTO_MAX_EDGE) {
    return err(
      failure(
        'PHOTO_SIZE',
        `A photo is between ${String(PHOTO_MIN_EDGE)} and ${String(PHOTO_MAX_EDGE)} pixels on each side`,
        ['file'],
      ),
    );
  }
  return read;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array) => PNG_SIGNATURE.every((v, i) => b[i] === v);
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const u32 = (b: Uint8Array, at: number) =>
  ((b[at] ?? 0) * 0x1000000 + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0)) >>> 0;
const u16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) + (b[at + 1] ?? 0);

/** Ancillary chunks that carry words rather than pixels. */
const PNG_METADATA = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function cleanPng(b: Uint8Array): Result<Photo> {
  const kept: Uint8Array[] = [b.subarray(0, 8)];
  let width = 0;
  let height = 0;
  let at = 8;
  let ended = false;
  while (at + 12 <= b.byteLength) {
    const length = u32(b, at);
    const end = at + 12 + length;
    if (end > b.byteLength) return broken();
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    if (type === 'IHDR') {
      width = u32(b, at + 8);
      height = u32(b, at + 12);
    }
    if (!PNG_METADATA.has(type)) kept.push(b.subarray(at, end));
    at = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended || width === 0) return broken();
  return ok({ mediaType: 'image/png', width, height, bytes: concat(kept) });
}

/** APP1 (EXIF, XMP), APP13 (IPTC), COM. APP0 (JFIF), APP2 (ICC) and APP14 (Adobe) stay. */
const JPEG_METADATA = new Set([0xe1, 0xed, 0xfe]);
const isFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function cleanJpeg(b: Uint8Array): Result<Photo> {
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let at = 2;
  while (at + 4 <= b.byteLength) {
    if (b[at] !== 0xff) return broken();
    const marker = b[at + 1] ?? 0;
    const end = at + 2 + u16(b, at + 2);
    if (end > b.byteLength) return broken();
    if (isFrame(marker)) {
      height = u16(b, at + 5);
      width = u16(b, at + 7);
    }
    if (!JPEG_METADATA.has(marker)) kept.push(b.subarray(at, end));
    if (marker === 0xda) {
      // Start of scan: what follows is the picture, to the end, copied as is.
      kept.push(b.subarray(end));
      return width === 0 ? broken() : ok({ mediaType: 'image/jpeg', width, height, bytes: concat(kept) });
    }
    at = end;
  }
  return broken();
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
