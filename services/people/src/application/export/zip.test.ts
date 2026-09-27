import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { storedZip } from './zip.js';

describe('storedZip', () => {
  it('writes an archive a standard reader opens, byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'photos.zip');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    writeFileSync(file, storedZip([
      { name: 'E-001.png', bytes: png },
      { name: 'Zoë.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 9]) },
    ]));
    // Python's zipfile checks every CRC and length on the way.
    const out = execFileSync('python3', [
      '-c',
      'import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:list(z.read(n)) for n in z.namelist()}))',
      file,
    ]).toString();
    expect(JSON.parse(out)).toEqual({ 'E-001.png': [...png], 'Zoë.jpg': [0xff, 0xd8, 0xff, 9] });
    expect(readFileSync(file).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 3, 4]));
  });
});
