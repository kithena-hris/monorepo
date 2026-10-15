import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { extract, unzipOne, xmlText } from './text.js';

/** A one-file zip, built the way an office suite writes one. */
function zip(name: string, content: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(content));
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralAt = local.length + nameBytes.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralAt, 16);
  return new Uint8Array(Buffer.concat([local, nameBytes, data, central, nameBytes, end]));
}

describe('text by code (PRD §14.1)', () => {
  it('reads a DOCX’s paragraphs', async () => {
    const docx = zip(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:t>Yuki Sato</w:t></w:r></w:p><w:p><w:r><w:t>Designer &amp; researcher</w:t></w:r></w:p></w:body></w:document>',
    );
    expect(unzipOne(docx, 'word/document.xml')).not.toBeNull();
    expect(
      await extract(
        docx,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('Yuki Sato\nDesigner & researcher');
  });

  it('has no text for an image or a broken file', async () => {
    expect(await extract(new Uint8Array([1, 2, 3]), 'application/pdf')).toBeNull();
    expect(await extract(new Uint8Array([1, 2, 3]), 'image/png')).toBeNull();
    expect(xmlText('<text:p>Hola</text:p><text:p>Madrid</text:p>')).toBe('Hola\nMadrid');
  });
});
