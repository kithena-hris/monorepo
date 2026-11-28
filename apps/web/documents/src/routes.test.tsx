import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
      ...manifest.sections.flatMap((s) => s.tabs),
      ...manifest.settings,
    ];
    const paths = places.flatMap((p) => [p.path, ...(p.owns ?? [])]);
    expect(paths.filter((p) => !routes.has(p))).toEqual([]);
  });
});

describe('the library (B1, B2)', () => {
  it('is one page: what needs Adam above the list, each document once, with who can see it', async () => {
    const { container } = render(<screens.Library load={ready(adamLibrary())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeTruthy();
    expect(screen.getByText('Add your Bank details form')).toBeTruthy();
    // Once: no second list repeats what the table says.
    expect(screen.getByRole('link', { name: 'Remote-work addendum' }).getAttribute('href')).toBe(
      '/documents/d/d-add',
    );
    expect(screen.queryByText('Recently updated')).toBeNull();
    expect(screen.getByText('Only you')).toBeTruthy();
    expect(screen.getAllByText('Confidential').length).toBeGreaterThan(0);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('is one field: words search, a question is Kithena’s to answer on Enter', () => {
    const asked: string[] = [];
    render(
      <screens.Library
        load={ready(adamLibrary())}
        onAskAcross={(q) => {
          asked.push(q);
          return Promise.resolve({ ok: false, message: 'no' });
        }}
      />,
    );
    const field = screen.getByRole('searchbox', { name: 'Search, or ask a question' });
    fireEvent.change(field, { target: { value: 'contract' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    // A word is a search: nothing is asked of Kithena.
    expect(asked).toEqual([]);
    fireEvent.change(field, { target: { value: 'When does my contract end?' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(asked).toEqual(['When does my contract end?']);
  });

  it('offers questions to start from when the field is focused, and asks the one picked', async () => {
    window.localStorage.clear();
    const onAskAcross = vi.fn(() => Promise.resolve({ ok: false as const, message: 'no' }));
    render(<screens.Library load={ready(adamLibrary())} onAskAcross={onAskAcross} />);
    expect(screen.queryByText('Try asking')).toBeNull();
    fireEvent.focus(screen.getByRole('searchbox', { name: 'Search, or ask a question' }));
    expect(await screen.findByText('Try asking')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'What is my notice period?' }));
    expect(onAskAcross).toHaveBeenCalledExactlyOnceWith('What is my notice period?');
    // Asked here before, it is offered once: as the suggestion it already is.
    expect(JSON.parse(window.localStorage.getItem('documents.library.recent') ?? '[]')).toEqual([
      'What is my notice period?',
    ]);
  });

  it('only searches where Kithena does not answer: no suggestions', () => {
    render(<screens.Library load={ready(adamLibrary())} />);
    fireEvent.focus(screen.getByRole('searchbox', { name: 'Search documents' }));
    expect(screen.queryByText('Try asking')).toBeNull();
  });

  it('is one place in the sidebar, its views the tabs of it', () => {
    expect(manifest.sections.map((s) => s.label)).toEqual(['Documents']);
    expect(manifest.sections[0]?.tabs.map((t) => t.path)).toEqual([
      '/documents/all',
      '/documents/envelopes',
      '/documents/compliance',
    ]);
  });

  it('is the queue itself at a queue’s address', async () => {
    const { container } = render(<screens.Library load={ready(adaLibrary())} />);
    // The same title and one line under it on every tab: the page holds still between them.
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Show' }).textContent).toContain(
      'Expiring in 60 days',
    );
    expect(screen.getByText('Work permit · Omar')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('loads a queue’s next page as its end nears, and says how many there are in all', async () => {
    const first = adaLibrary();
    const row = first.queueRows[0];
    if (row === undefined) throw new Error('the fixture has a queue row');
    const onLoadMoreQueue = vi.fn(() =>
      Promise.resolve({
        rows: [{ ...row, id: 'd-permit-2', title: 'Work permit · Mei' }],
        next: null,
      }),
    );
    render(
      <screens.Library
        load={ready({ ...first, queueNext: '1', queueTotal: 2 })}
        onLoadMoreQueue={onLoadMoreQueue}
      />,
    );
    expect(await screen.findByText('Work permit · Mei')).toBeTruthy();
    expect(onLoadMoreQueue).toHaveBeenCalledExactlyOnceWith('expiring', '1');
    expect(screen.getByText('Work permit · Omar')).toBeTruthy();
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
