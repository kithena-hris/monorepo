import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { ImportExport, filterHistory, type TransferEntry } from './import-export';

const entry = (over: Partial<TransferEntry> & Pick<TransferEntry, 'id'>): TransferEntry => ({
  kind: 'import',
  title: 'new-joiners.csv',
  by: { name: 'Ada Lovelace', avatarUrl: null },
  at: 'Today 14:02',
  result: '12 created',
  tone: 'success',
  href: null,
  ...over,
});

const history = [
  entry({ id: 'i1' }),
  entry({
    id: 'e1',
    kind: 'export',
    title: 'Payroll reconciliation',
    by: { name: 'Sofia Lindqvist', avatarUrl: null },
    result: '412 people · CSV',
    tone: 'neutral',
    href: '/files/e1',
  }),
];

describe('filterHistory', () => {
  it('narrows by kind, then by a file, a reason or a person, in any case', () => {
    expect(filterHistory(history, 'all', '').map((e) => e.id)).toEqual(['i1', 'e1']);
    expect(filterHistory(history, 'import', '').map((e) => e.id)).toEqual(['i1']);
    expect(filterHistory(history, 'export', '').map((e) => e.id)).toEqual(['e1']);
    expect(filterHistory(history, 'all', 'PAYROLL').map((e) => e.id)).toEqual(['e1']);
    expect(filterHistory(history, 'all', ' ada ').map((e) => e.id)).toEqual(['i1']);
    expect(filterHistory(history, 'import', 'sofia')).toEqual([]);
  });
});

describe('ImportExport', () => {
  it('starts either flow, and says there is no history rather than drawing one', async () => {
    const { container } = render(
      <ImportExport load={{ status: 'ready', data: { canImport: true, history: null } }} />,
    );
    expect(screen.getByRole('link', { name: 'Start import' })).toHaveAttribute(
      'href',
      '/people/import',
    );
    expect(screen.getByRole('link', { name: 'New export' })).toHaveAttribute(
      'href',
      '/people/export',
    );
    expect(screen.getByText('No history to show yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers import only to whoever could import before', () => {
    render(<ImportExport load={{ status: 'ready', data: { canImport: false, history: null } }} />);
    expect(screen.queryByRole('link', { name: 'Start import' })).toBeNull();
    expect(screen.getByRole('link', { name: 'New export' })).toBeInTheDocument();
  });

  it('filters one shared history by kind and by search', async () => {
    const user = fast();
    const { container } = render(
      <ImportExport load={{ status: 'ready', data: { canImport: true, history } }} />,
    );
    const table = screen.getByRole('table', { name: 'Imports and exports' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(
      within(table).getByRole('link', { name: 'Download Payroll reconciliation' }),
    ).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('radio', { name: 'Exports' }));
    expect(within(table).queryByText('new-joiners.csv')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search the history' }), 'zz');
    expect(screen.getByText('Nothing matches')).toBeInTheDocument();
  });
});
