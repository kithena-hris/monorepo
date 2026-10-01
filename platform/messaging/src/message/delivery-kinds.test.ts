import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { NOTICE_KINDS } from './domain/notice.js';

/**
 * `messaging.delivery.kind` is checked by `delivery_kind_known`, and several
 * modules' migrations rewrite that constraint as they add a notice. A kind the
 * code sends but the constraint omits is a delivery that is never recorded,
 * found only in production. The latest migration to rewrite it must list
 * exactly what the code sends.
 */
const MIGRATIONS = new URL('../../../../migrations/', import.meta.url);

describe('delivery_kind_known', () => {
  it('lists every kind messaging sends, and nothing else', async () => {
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).toSorted();
    let latest = '';
    for (const file of files) {
      const text = await readFile(new URL(file, MIGRATIONS), 'utf8');
      if (text.includes('ADD CONSTRAINT delivery_kind_known')) latest = text;
    }
    const check = /ADD CONSTRAINT delivery_kind_known CHECK \(\s*kind IN \(([^)]*)\)/u.exec(latest);
    const listed = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/gu)].map((m) => m[1]);
    expect(listed.toSorted()).toEqual(['account_invitation', ...NOTICE_KINDS].toSorted());
  });
});
