import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { formValues, VIEWS } from './people-views';

describe('a record back from GraphQL', () => {
  it('has exactly the keys People sent, each as the form holds it', () => {
    expect(
      formValues([
        { __typename: 'TextEntry', key: 'job_title', text: 'Engineer' },
        { __typename: 'FlagEntry', key: 'remote', flag: true },
        { __typename: 'ListEntry', key: 'languages', items: ['es', 'en'] },
        { __typename: 'MoneyEntry', key: 'base_salary', amountMinor: '5500000', currency: 'EUR' },
        { __typename: 'SealedEntry', key: 'iban', last4: '1234' },
        { __typename: 'EmptyEntry', key: 'nickname' },
      ]),
    ).toEqual({
      job_title: 'Engineer',
      remote: true,
      languages: ['es', 'en'],
      base_salary: { amountMinor: '5500000', currency: 'EUR' },
      iban: { last4: '1234' },
      nickname: null,
    });
  });

  it('keeps a withheld field absent — not a key with null', () => {
    const profile = VIEWS.Profile({
      person: { name: 'Ada' },
      sections: [
        {
          key: 'job',
          fields: [{ key: 'job_title', label: 'Job title', currency: null, ownedBy: null }],
        },
      ],
      values: [{ __typename: 'TextEntry', key: 'job_title', text: 'Engineer' }],
    });
    expect(Object.hasOwn(profile.values, 'base_salary')).toBe(false);
    expect(profile.sections[0]?.fields[0]).toEqual({ key: 'job_title', label: 'Job title' });
  });
});

describe('the shell', () => {
  it('has no direct way into People: no address, no token, no REST path, no principal', async () => {
    const root = join(import.meta.dirname, '..');
    const files = (await readdir(root, { recursive: true }))
      .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.endsWith('.test.ts'))
      .map((f) => join(root, f));
    const offending: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const needle of ['PEOPLE_API_URL', 'PEOPLE_API_TOKEN', 'x-kithena-principal', "'/v1/"]) {
        if (text.includes(needle)) offending.push(`${file}: ${needle}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
