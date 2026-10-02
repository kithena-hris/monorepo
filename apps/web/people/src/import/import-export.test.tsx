import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import {
  ImportExport,
  filterHistory,
  resultOf,
  whenOf,
  type ImportExportState,
  type TransferEntry,
} from './import-export';

const NOW = '2026-09-29T15:00:00.000Z';

const entry = (over: Partial<TransferEntry> & Pick<TransferEntry, 'id'>): TransferEntry => ({
  kind: 'import',
  title: 'new-joiners.csv',
  by: { name: 'Ada Lovelace', avatarUrl: null },
  at: '2026-09-29T14:02:00.000Z',
  imported: { created: 12, updated: 0, blocked: 0 },
  exported: null,
  downloadable: false,
  reportUrl: null,
  ...over,
});

const items = [
  entry({ id: 'i1', reportUrl: 'https://files.test/report?sig=s' }),
  entry({
    id: 'e1',
    kind: 'export',
    title: 'Payroll reconciliation',
    by: { name: 'Sofia Lindqvist', avatarUrl: null },
    at: '2026-09-28T09:02:00.000Z',
    imported: null,
    exported: { rows: 412, format: 'csv' },
    downloadable: true,
  }),
  // Somebody else's export: listed, never offered.
  entry({
    id: 'e2',
    kind: 'export',
    title: 'Quarterly headcount',
    at: '2026-09-15T09:02:00.000Z',
    imported: null,
    exported: { rows: 124, format: 'xlsx' },
  }),
];

const state = (over: Partial<ImportExportState> = {}): ImportExportState => ({
  canImport: true,
  history: { items, next: null, paged: false },
  now: NOW,
  ...over,
});

describe('filterHistory', () => {
  it('narrows by kind, then by a file, a reason or a person, in any case', () => {
    expect(filterHistory(items, 'all', '').map((e) => e.id)).toEqual(['i1', 'e1', 'e2']);
    expect(filterHistory(items, 'import', '').map((e) => e.id)).toEqual(['i1']);
    expect(filterHistory(items, 'export', '').map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(filterHistory(items, 'all', 'PAYROLL').map((e) => e.id)).toEqual(['e1']);
    expect(filterHistory(items, 'all', ' ada ').map((e) => e.id)).toEqual(['i1', 'e2']);
    expect(filterHistory(items, 'import', 'sofia')).toEqual([]);
  });
});

describe('the wording of an entry', () => {
  it('says what an import did, and warns when rows were skipped', () => {
    expect(resultOf(entry({ id: 'a', imported: { created: 300, updated: 69, blocked: 0 } }))).toEqual(
      { text: '369 created or updated', tone: 'success' },
    );
    expect(resultOf(entry({ id: 'b', imported: { created: 12, updated: 0, blocked: 2 } }))).toEqual({
      text: '12 created · 2 skipped',
      tone: 'warning',
    });
  });

  it('says how many people an export held, in what, and when one is still being prepared', () => {
    expect(resultOf(items[1] as TransferEntry)).toEqual({ text: '412 people · CSV', tone: 'neutral' });
    expect(
      resultOf(entry({ id: 'q', kind: 'export', imported: null, exported: null })).text,
    ).toBe('Being prepared');
  });

  it('says when as the design does: today, a weekday this week, a date before', () => {
    expect(whenOf('2026-09-29T14:02:00.000Z', NOW, 'UTC')).toBe('Today 14:02');
    expect(whenOf('2026-09-28T09:02:00.000Z', NOW, 'UTC')).toBe('Mon 09:02');
    expect(whenOf('2026-09-15T09:02:00.000Z', NOW, 'UTC')).toBe('15 Sep');
  });
});

describe('ImportExport', () => {
  it('starts either flow, and offers HR the template as a file', async () => {
    const { container } = render(<ImportExport load={{ status: 'ready', data: state() }} />);
    expect(screen.getByRole('link', { name: 'Start import' })).toHaveAttribute(
      'href',
      '/people/import-export?import=new',
    );
    const template = screen.getByRole('link', { name: 'Template' });
    expect(template).toHaveAttribute('href', '/people/downloads/import-template');
    expect(template).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'New export' })).toHaveAttribute(
      'href',
      '/people/export',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers import only to whoever could import before, and no history to whoever may not read it', () => {
    render(
      <ImportExport
        load={{ status: 'ready', data: state({ canImport: false, history: null }) }}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Start import' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Template' })).toBeNull();
    expect(screen.getByRole('link', { name: 'New export' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'History' })).toBeNull();
  });

  it('offers no template before the employee record is set up: there is nothing to template yet', () => {
    render(<ImportExport load={{ status: 'ready', data: state({ setUp: false }) }} />);
    expect(screen.getByRole('link', { name: 'Start import' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Template' })).toBeNull();
  });

  it('says so when nothing has been imported or exported yet', () => {
    render(
      <ImportExport
        load={{
          status: 'ready',
          data: state({ history: { items: [], next: null, paged: false } }),
        }}
      />,
    );
    expect(screen.getByText('Nothing imported or exported yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('lists one shared history, with a download only where one still opens', async () => {
    const user = fast();
    const { container } = render(<ImportExport load={{ status: 'ready', data: state() }} />);
    const table = screen.getByRole('table', { name: 'Imports and exports' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('12 created or updated')).toBeVisible();
    expect(within(table).getByText('412 people · CSV')).toBeVisible();
    expect(within(table).getByRole('link', { name: 'Download Payroll reconciliation' })).toHaveAttribute(
      'href',
      '/people/export?export=e1',
    );
    expect(within(table).getByRole('link', { name: 'Report of new-joiners.csv' })).toHaveAttribute(
      'href',
      'https://files.test/report?sig=s',
    );
    expect(within(table).queryByRole('link', { name: 'Download Quarterly headcount' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('radio', { name: 'Exports' }));
    expect(within(table).queryByText('new-joiners.csv')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search the history' }), 'zz');
    expect(screen.getByText('Nothing matches')).toBeInTheDocument();
  });

  it('pages back through older entries, and returns to the newest', () => {
    render(
      <ImportExport
        load={{ status: 'ready', data: state({ history: { items, next: 'e2', paged: true } }) }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Older' })).toHaveAttribute(
      'href',
      '/people/import-export?before=e2',
    );
    expect(screen.getByRole('link', { name: 'Newest' })).toHaveAttribute(
      'href',
      '/people/import-export',
    );
  });
});

describe('the history’s filters, in the address', () => {
  it('opens narrowed as a link left it, and keeps it on the older pages', () => {
    render(
      <ImportExport
        load={{ status: 'ready', data: state({ history: { items, next: 'e2', paged: false } }) }}
        kind="export"
        onKindChange={vi.fn()}
        search="payroll"
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Exports' })).toBeChecked();
    expect(screen.getByRole('searchbox', { name: 'Search the history' })).toHaveValue('payroll');
    expect(screen.queryByText('new-joiners.csv')).toBeNull();
    expect(screen.getByRole('link', { name: 'Older' })).toHaveAttribute(
      'href',
      '/people/import-export?before=e2&kind=export&q=payroll',
    );
  });

  it('hands a chosen kind to the host', async () => {
    const user = fast();
    const onKindChange = vi.fn();
    render(
      <ImportExport
        load={{ status: 'ready', data: state() }}
        kind="all"
        onKindChange={onKindChange}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Imports' }));
    expect(onKindChange).toHaveBeenCalledWith('import');
  });
});
