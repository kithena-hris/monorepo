import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import {
  ImportFlow,
  type ImportFlowProps,
  type ImportStage,
  type ProposedColumn,
} from './import-flow';

const file = { name: 'acme-people-sept.xlsx', rows: 412, sheet: 'Employees' };
const fields = [
  { key: 'employee_number', label: 'Employee number' },
  { key: 'cost_centre', label: 'Cost centre' },
  { key: 'locker_no', label: 'Locker no.' },
];
const column = (
  over: Partial<ProposedColumn> & Pick<ProposedColumn, 'index' | 'header'>,
): ProposedColumn => ({
  status: 'mapped',
  key: null,
  source: 'label',
  confidence: null,
  reason: null,
  ...over,
});

const mapping: ImportStage = {
  step: 'map',
  file,
  fields,
  columns: [
    column({
      index: 0,
      header: 'Employee ID',
      key: 'employee_number',
      source: 'suggested',
      confidence: 0.97,
    }),
    column({
      index: 1,
      header: 'CC',
      key: 'cost_centre',
      status: 'review',
      source: 'suggested',
      confidence: 0.71,
    }),
    column({ index: 2, header: 'Old system ID', status: 'ignored', source: null }),
    column({
      index: 3,
      header: 'Salary',
      key: 'base_salary',
      status: 'refused',
      source: 'label',
      reason: 'Only finance writes pay.',
    }),
  ],
};

const review: ImportStage = {
  step: 'review',
  file,
  dryRun: {
    counts: { create: 368, update: 21, unchanged: 4, blocked: 14, duplicate: 5 },
    incomplete: {
      count: 88,
      byField: [
        { label: 'Cost centre', count: 61 },
        { label: 'Home address', count: 27 },
      ],
    },
    ignoredColumns: ['Old system ID'],
    blocked: [
      { row: 18, person: 'Iria Fernández', problem: 'No work email', cell: 'D18 — empty' },
      {
        row: 47,
        person: 'Kwame Boateng',
        problem: 'Invalid hire date',
        cell: 'F47 — “31/02/2025”',
      },
    ],
  },
};

function props(
  load: ImportFlowProps['load'],
  over: Partial<ImportFlowProps> = {},
): ImportFlowProps {
  const ok = () => Promise.resolve({ ok: true as const });
  return {
    load,
    onUpload: vi.fn(ok),
    onMap: vi.fn(ok),
    onCommit: vi.fn(ok),
    onDownloadBlocked: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
}

describe('ImportFlow', () => {
  it('uploads through a Dropzone', async () => {
    const user = fast();
    const onUpload = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <ImportFlow {...props({ status: 'ready', data: { step: 'upload' } }, { onUpload })} />,
    );
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    const sheet = new File(['a,b'], 'people.csv', { type: 'text/csv' });
    await user.upload(input, sheet);
    expect(onUpload).toHaveBeenCalledWith(sheet);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the mapping with its confidence, and waits for a decision on a doubtful column', async () => {
    const user = fast();
    const onMap = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <ImportFlow {...props({ status: 'ready', data: mapping }, { onMap })} />,
    );
    expect(screen.getByText('0.97')).toBeInTheDocument();
    expect(screen.getByText('0.71, check this')).toBeInTheDocument();
    expect(screen.getByText('Only finance writes pay.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review before importing' })).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('combobox', { name: 'CC goes to' }));
    await user.click(await screen.findByRole('option', { name: 'Cost centre' }));
    await user.click(screen.getByRole('button', { name: 'Review before importing' }));
    expect(onMap).toHaveBeenCalledWith({
      0: 'employee_number',
      1: 'cost_centre',
      2: null,
      3: null,
    });
  });

  it('needs no mapping at all for a file that maps itself, like the blocked-rows file', async () => {
    const user = fast();
    const onMap = vi.fn(() => Promise.resolve({ ok: true as const }));
    const again: ImportStage = {
      ...mapping,
      columns: [
        column({ index: 0, header: 'employee_number', key: 'employee_number', source: 'key' }),
        column({
          index: 1,
          header: '__source_row',
          status: 'ignored',
          key: '__source_row',
          source: 'system',
        }),
        column({
          index: 2,
          header: '__reason',
          status: 'ignored',
          key: '__reason',
          source: 'system',
        }),
      ],
    };
    render(<ImportFlow {...props({ status: 'ready', data: again }, { onMap })} />);
    await user.click(screen.getByRole('button', { name: 'Review before importing' }));
    expect(onMap).toHaveBeenCalledWith({ 0: 'employee_number', 1: null, 2: null });
  });

  it('states every count before anything is written, and the blocked rows download', async () => {
    const user = fast();
    const onCommit = vi.fn(() => Promise.resolve({ ok: true as const }));
    const onDownloadBlocked = vi.fn();
    const { container } = render(
      <ImportFlow {...props({ status: 'ready', data: review }, { onCommit, onDownloadBlocked })} />,
    );
    expect(
      screen.getByText('389 rows will import, and 88 of them will be incomplete'),
    ).toBeInTheDocument();
    expect(screen.getByText(/61 have no Cost centre, 27 have no Home address/)).toBeInTheDocument();
    expect(screen.getByText('Not imported: Old system ID.')).toBeInTheDocument();
    expect(screen.getByText('F47 — “31/02/2025”')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Download all 19 as CSV' }));
    expect(onDownloadBlocked).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Import 389 rows' }));
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('lists doubted identifiers per cell without blocking the rows (PEO-125)', async () => {
    const onCommit = vi.fn(() => Promise.resolve({ ok: true as const }));
    const doubted: ImportStage = {
      ...review,
      dryRun: {
        ...review.dryRun,
        findings: [
          {
            row: 12,
            cell: 'E12',
            label: 'NIF / NIE',
            level: 'mismatch',
            message: 'Matches the national format, but the control letter does not compute.',
          },
        ],
      },
    };
    const { container } = render(
      <ImportFlow {...props({ status: 'ready', data: doubted }, { onCommit })} />,
    );
    expect(screen.getByText('Our checks suggest 1 identifier may be wrong')).toBeInTheDocument();
    expect(screen.getByText('E12')).toBeInTheDocument();
    expect(screen.getByText(/control letter does not compute/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    await fast().click(screen.getByRole('button', { name: 'Import 389 rows' }));
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('has loading and error states, and says why a step was refused', async () => {
    const user = fast();
    const { container, rerender } = render(<ImportFlow {...props({ status: 'loading' })} />);
    expect(screen.getByText('Loading the import')).toBeInTheDocument();
    rerender(<ImportFlow {...props({ status: 'error', message: 'Down' })} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    rerender(
      <ImportFlow
        {...props(
          { status: 'ready', data: review },
          { onCommit: () => Promise.resolve({ ok: false, message: 'Another import is running' }) },
        )}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Import 389 rows' }));
    expect(await screen.findByText('Another import is running')).toBeInTheDocument();
  });
});
