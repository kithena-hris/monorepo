import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import manifest from '../public/routes.json';
import * as screens from './index';
import { sentence } from './settings/settings';
import {
  adaLibrary,
  adaSettings,
  adamDocument,
  adamLibrary,
  closedDocument,
  meiFile,
} from './test/acme.fixture';
import { axeViolations } from './test/axe';

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
const routes = new Set(manifest.routes.map((r) => r.path));

describe('routes.json', () => {
  it('points every route at a screen index.ts exports', () => {
    const exported = new Set(Object.keys(screens));
    expect(manifest.routes.filter((r) => !exported.has(r.component))).toEqual([]);
  });

  it('lists every place and owned path as a route of its own', () => {
    const places: readonly { path: string; owns?: readonly string[] }[] = [
      ...manifest.sections,
      ...manifest.settings,
    ];
    const paths = places.flatMap((p) => [p.path, ...(p.owns ?? [])]);
    expect(paths.filter((p) => !routes.has(p))).toEqual([]);
  });
});

describe('the library (B1, B2)', () => {
  it('shows what needs Adam, then each document with who can see it', async () => {
    const { container } = render(<screens.Library load={ready(adamLibrary())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeTruthy();
    expect(screen.getByText('Add your Bank details form')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Remote-work addendum' }).getAttribute('href')).toBe(
      '/documents/d/d-add',
    );
    expect(screen.getByText('Only you')).toBeTruthy();
    expect(screen.getAllByText('Confidential').length).toBeGreaterThan(0);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('gives HR the four queues, one open in place', async () => {
    const { container } = render(<screens.Library load={ready(adaLibrary())} />);
    expect(screen.getByRole('link', { name: /Expiring/ }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByText('Work permit · Omar')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says why when Documents refused', () => {
    render(<screens.Library load={{ status: 'error', message: 'Documents did not answer' }} />);
    expect(screen.getByText('Documents did not answer')).toBeTruthy();
  });
});

describe('a document (D1, E2, E3)', () => {
  it('says it is Confidential, and offers its person the download', async () => {
    const { container } = render(<screens.DocumentView load={ready(adamDocument())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Remote-work addendum' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says who owns one you cannot open, and offers to ask', async () => {
    const { container } = render(
      <screens.DocumentView load={ready(closedDocument())} path="/documents/d/d-x" />,
    );
    expect(screen.getByText('You can’t open this yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask for access' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('a person’s file (B3)', () => {
  it('lists what is required, with one action a row', async () => {
    const { container } = render(<screens.PersonFile load={ready(meiFile())} />);
    expect(screen.getByText(/1 of 3/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remind' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('settings (S2, S5, S6)', () => {
  it('says each type as a sentence', async () => {
    const data = adaSettings();
    const { container } = render(<screens.DocumentTypes load={ready(data)} />);
    const first = data.types[0];
    if (first === undefined) throw new Error('no type');
    expect(sentence(first)).toBe(
      'Filed to each person. the person and HR see it, Confidential. Signed by them, then HR. Required for new starters, before day one. Kept 4 years after they leave.',
    );
    expect(screen.getByText('Employment contract')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws the access defaults and the holds', async () => {
    const access = render(<screens.AccessSettings load={ready(adaSettings())} />);
    expect(await axeViolations(access.container)).toEqual([]);
    access.unmount();
    const retention = render(<screens.RetentionSettings load={ready(adaSettings())} />);
    expect(screen.getByText('Case 0412')).toBeTruthy();
    expect(await axeViolations(retention.container)).toEqual([]);
  });
});
