import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { framed } from '../frame';
import { serveAndHydrate } from '../test/hydrate';
import {
  Directory as DirectoryScreen,
  type DirectoryProps,
  type DirectoryState,
} from './directory';

// As `index.ts` exposes it, and the shell renders it.
const Directory = framed(DirectoryScreen);

const state: DirectoryState = {
  total: 2,
  active: 2,
  notStarted: 0,
  incomplete: 1,
  columns: [{ key: 'job_title', label: 'Job title' }],
  fields: [{ key: 'job_title', label: 'Job title', kind: 'text', options: [] }],
  filterable: [],
  people: [
    {
      id: 'a',
      name: 'Adam Reyes',
      email: 'adam@acme.example',
      avatarUrl: null,
      values: { job_title: 'Support Engineer' },
      missing: 0,
    },
    {
      id: 'l',
      name: 'Lena Moreau',
      email: 'lena@acme.example',
      avatarUrl: null,
      values: { job_title: 'Staff Engineer' },
      missing: 2,
    },
  ],
};

const props = (over: Partial<DirectoryProps>): DirectoryProps => ({
  load: { status: 'ready', data: state },
  search: '',
  onSearchChange: vi.fn(),
  filters: {},
  onFiltersChange: vi.fn(),
  onConditionsChange: vi.fn(),
  onOpen: vi.fn(),
  ...over,
});

describe('the directory, served whole and hydrated', () => {
  it('opens on the quick look the address names, without a mismatch', async () => {
    const { html, errors } = await serveAndHydrate(
      createElement(Directory, props({ look: 'l', onLookChange: vi.fn() })),
    );
    expect(html).toContain('Lena Moreau');
    expect(html).toContain('Open profile');
    expect(errors).toEqual([]);
  });

  it('draws the filters dialog the address asks for in the first HTML', async () => {
    const { html, errors } = await serveAndHydrate(
      createElement(Directory, props({ filtersOpen: true, onFiltersOpenChange: vi.fn() })),
    );
    expect(html).toContain('Filter people');
    expect(errors).toEqual([]);
  });

  it('draws Add person the address asks for in the first HTML', async () => {
    const { html, errors } = await serveAndHydrate(
      createElement(
        Directory,
        props({
          adding: true,
          onAddingChange: vi.fn(),
          onAdd: () => Promise.resolve({ ok: true as const }),
        }),
      ),
    );
    expect(html).toContain('Add a person');
    expect(errors).toEqual([]);
  });
});
