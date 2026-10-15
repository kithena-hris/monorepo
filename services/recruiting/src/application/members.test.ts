import { describe, expect, it } from 'vitest';

import { parseCsv } from './members.js';

describe('the member file', () => {
  it('reads quoted fields, doubled quotes and CRLF', () => {
    expect(parseCsv('personId,displayName\r\n1,"Sato, ""Yuki"""\r\n\r\n2,Ada\n')).toEqual([
      ['personId', 'displayName'],
      ['1', 'Sato, "Yuki"'],
      ['2', 'Ada'],
    ]);
  });
});
