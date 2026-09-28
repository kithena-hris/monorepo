import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { cleanImage } from './photo.js';

/**
 * A file for an `image` or `document_ref` field: what it may be, judged from
 * the bytes.
 *
 * The name and the type a browser declares are the uploader's to say and
 * nobody's to trust, so the type is read from the file itself. An image is a
 * PNG or a JPEG, kept without its EXIF, XMP, IPTC and comments (where a phone
 * keeps the GPS fix of somebody's kitchen); a document is a PDF, or an image
 * treated the same way. Anything else is refused rather than stored as
 * something nothing here can check.
 *
 * Pure: bytes in, bytes out.
 */

export type FileMediaType = 'image/png' | 'image/jpeg' | 'application/pdf';

export type FileRules =
  | { readonly kind: 'image'; readonly maxBytes: number }
  | {
      readonly kind: 'document_ref';
      readonly accepts: readonly string[];
      readonly maxBytes: number;
    };

export interface FieldFile {
  readonly mediaType: FileMediaType;
  readonly bytes: Uint8Array;
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const isPdf = (b: Uint8Array) => PDF.every((v, i) => b[i] === v);

const MB = (n: number) => `${String(Math.round((n / (1024 * 1024)) * 10) / 10)} MB`;

export function readFieldFile(bytes: Uint8Array, rules: FileRules): Result<FieldFile> {
  if (bytes.byteLength === 0) return err(failure('FILE_TYPE', 'The file is empty', ['file']));
  if (bytes.byteLength > rules.maxBytes) {
    return err(
      failure('FILE_TOO_LARGE', `This field takes files up to ${MB(rules.maxBytes)}`, ['file']),
    );
  }
  const read: Result<FieldFile> =
    rules.kind === 'document_ref' && isPdf(bytes)
      ? ok({ mediaType: 'application/pdf', bytes })
      : (() => {
          const image = cleanImage(bytes);
          return image.ok
            ? ok({ mediaType: image.value.mediaType, bytes: image.value.bytes })
            : err(
                failure(
                  'FILE_TYPE',
                  rules.kind === 'image'
                    ? 'An image is a PNG or a JPEG'
                    : 'A document is a PDF, a PNG or a JPEG',
                  ['file'],
                ),
              );
        })();
  if (!read.ok) return read;
  if (
    rules.kind === 'document_ref' &&
    rules.accepts.length > 0 &&
    !rules.accepts.includes(read.value.mediaType)
  ) {
    return err(failure('FILE_TYPE', `This field takes ${rules.accepts.join(', ')}`, ['file']));
  }
  return read;
}
