import { inflateRawSync } from 'node:zlib';
import { extractText } from 'unpdf';

/**
 * A file's text, by code (PRD §14.1, REC-042): the PDF text layer through
 * unpdf (Documents' choice), and DOCX and ODT as the XML inside their zip,
 * read with Node's own inflate rather than another dependency. A scanned PDF
 * gives no text; a person reads it.
 */

/** One file out of a zip archive, by name; null when it is not there. */
export function unzipOne(bytes: Uint8Array, wanted: string): Uint8Array | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record, searched from the end (a comment may follow it).
  let end = -1;
  for (let i = view.length - 22; i >= Math.max(0, view.length - 65_557); i -= 1) {
    if (view.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const entries = view.readUInt16LE(end + 10);
  let at = view.readUInt32LE(end + 16);
  for (let n = 0; n < entries && at + 46 <= view.length; n += 1) {
    if (view.readUInt32LE(at) !== 0x02014b50) return null;
    const method = view.readUInt16LE(at + 10);
    const size = view.readUInt32LE(at + 20);
    const nameLength = view.readUInt16LE(at + 28);
    const extra = view.readUInt16LE(at + 30);
    const comment = view.readUInt16LE(at + 32);
    const local = view.readUInt32LE(at + 42);
    const name = view.toString('utf8', at + 46, at + 46 + nameLength);
    if (name === wanted) {
      const start = local + 30 + view.readUInt16LE(local + 26) + view.readUInt16LE(local + 28);
      const data = view.subarray(start, start + size);
      if (method === 0) return new Uint8Array(data);
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      return null;
    }
    at += 46 + nameLength + extra + comment;
  }
  return null;
}

/** The words in an office document's XML, paragraphs on their own lines. */
export function xmlText(xml: string): string {
  const decode = (t: string) =>
    t
      .replace(/&lt;/gu, '<')
      .replace(/&gt;/gu, '>')
      .replace(/&quot;/gu, '"')
      .replace(/&apos;/gu, "'")
      .replace(/&amp;/gu, '&');
  // Paragraph ends become line breaks; the text is what lies between the tags.
  const marked = xml
    .replaceAll('</w:p>', '\u0000')
    .replaceAll('</text:p>', '\u0000')
    .replaceAll('</text:h>', '\u0000');
  const text = marked
    .split(/<[^>]*>/u)
    .map(decode)
    .join('')
    .split('\u0000')
    .map((line) => line.trim())
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n');
  return text.trim();
}

export async function extract(bytes: Uint8Array, mediaType: string): Promise<string | null> {
  try {
    if (mediaType === 'application/pdf') {
      const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
      const words = text.trim();
      return words === '' ? null : words;
    }
    const inner =
      mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ? 'word/document.xml'
        : mediaType === 'application/vnd.oasis.opendocument.text'
          ? 'content.xml'
          : null;
    if (inner !== null) {
      const xml = unzipOne(bytes, inner);
      const words = xml === null ? '' : xmlText(new TextDecoder().decode(xml));
      return words === '' ? null : words;
    }
    if (mediaType === 'application/rtf' || mediaType === 'text/rtf') {
      const words = new TextDecoder()
        .decode(bytes)
        .replace(/\\[a-z]+-?\d* ?|[{}]/gu, '')
        .trim();
      return words === '' ? null : words;
    }
    return null;
  } catch {
    // A file that will not open has no text; it is kept, and a person reads it.
    return null;
  }
}
