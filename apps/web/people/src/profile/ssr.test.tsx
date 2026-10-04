import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { framed } from '../frame';
import type { RecordField } from '../record/model';
import { serveAndHydrate } from '../test/hydrate';
import { PersonHistory as HistoryScreen, type HistoryState } from './history';
import { Profile as ProfileScreen, type ProfileState } from './profile';

// As `index.ts` exposes them, and the shell renders them.
const Profile = framed(ProfileScreen);
const PersonHistory = framed(HistoryScreen);

const field = (over: Partial<RecordField> & Pick<RecordField, 'key' | 'label'>): RecordField => ({
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  readOnly: false,
  ...over,
});

const record: ProfileState = {
  person: { name: 'Adam Novak', summary: 'Backend engineer · Madrid', avatarUrl: null, missing: 1 },
  sections: [
    {
      key: 'work',
      label: 'Work',
      visibility: ['hr'],
      readsLogged: false,
      fields: [field({ key: 'job_title', label: 'Job title' })],
    },
    {
      key: 'bank',
      label: 'Bank and tax',
      visibility: ['hr'],
      readsLogged: true,
      fields: [field({ key: 'iban', label: 'Bank account', required: true, missing: true })],
    },
  ],
  values: { job_title: 'Backend engineer' },
  calendar: { today: '2026-10-03', timeZone: 'Europe/Madrid' },
  employment: { status: 'active', periods: [] },
};

describe('a profile, served whole and hydrated', () => {
  it('draws the record card and every section, without a mismatch', async () => {
    const { html, errors } = await serveAndHydrate(
      createElement(Profile, {
        load: { status: 'ready', data: record },
        onSave: vi.fn(),
        onMove: vi.fn(),
        historyHref: '/people/a/history',
      }),
    );
    expect(html).toContain('Parts of the record');
    expect(html).toContain('Bank and tax');
    expect(errors).toEqual([]);
  });

  it('draws the move and the section the address names in the first HTML', async () => {
    const { html, errors } = await serveAndHydrate(
      createElement(Profile, {
        load: { status: 'ready', data: record },
        onSave: vi.fn(),
        onMove: vi.fn(),
        open: 'move:terminate',
        onOpenChange: vi.fn(),
        editing: 'work',
        onEditingChange: vi.fn(),
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Editing');
    expect(errors).toEqual([]);
  });
});

const history: HistoryState = {
  person: { id: 'a', name: 'Adam Novak' },
  asOf: '2025-06-01',
  sections: record.sections,
  dated: ['job_title'],
  values: { job_title: 'Backend engineer' },
  changes: [],
};

describe('a history, served whole and hydrated', () => {
  it('draws the record as it was on the date the address names, without a mismatch', async () => {
    const { html, errors } = await serveAndHydrate(
      createElement(PersonHistory, {
        load: { status: 'ready', data: history },
        onAsOf: vi.fn(),
      }),
    );
    expect(html).toContain('As it stood on');
    expect(errors).toEqual([]);
  });
});
