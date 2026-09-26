import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { ExportBuilder, type ExportState } from './export-builder';

const who = [
  { value: 'filter', label: 'Current filter', count: 412 },
  { value: 'team', label: 'My team', count: 8 },
];

/** What HR reads, and what a manager's profile view leaves them. */
const asHr: ExportState = {
  today: '2026-09-22',
  who,
  sections: [
    {
      key: 'hr',
      label: 'HR information',
      fields: [
        { key: 'employee_number', label: 'Employee number' },
        { key: 'cost_centre', label: 'Cost centre' },
      ],
    },
    {
      key: 'compensation',
      label: 'Compensation',
      fields: [{ key: 'base_salary', label: 'Base salary' }],
    },
  ],
};
const asManager: ExportState = {
  today: '2026-09-22',
  who: [{ value: 'team', label: 'My team', count: 8 }],
  sections: [{ key: 'work', label: 'Work', fields: [{ key: 'work_model', label: 'Work model' }] }],
};

describe('ExportBuilder', () => {
  it('offers a manager only the fields their profile view shows, and exports only those', async () => {
    const user = fast();
    const onExport = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <ExportBuilder load={{ status: 'ready', data: asManager }} onExport={onExport} />,
    );
    for (const withheld of ['Base salary', 'Compensation', 'Employee number', 'Cost centre']) {
      expect(container.textContent).not.toContain(withheld);
    }
    expect(screen.queryByText(/everything/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Export 8 people' }));
    expect(onExport).toHaveBeenCalledWith({
      who: 'team',
      fields: ['work_model'],
      asOf: '2026-09-22',
      format: 'xlsx',
    });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('picks fields by section and one by one, and chooses the format', async () => {
    const user = fast();
    const onExport = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<ExportBuilder load={{ status: 'ready', data: asHr }} onExport={onExport} />);
    await user.click(screen.getByRole('checkbox', { name: 'Compensation' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cost centre' }));
    expect(screen.getByRole('checkbox', { name: 'HR information' })).toHaveAttribute(
      'data-state',
      'indeterminate',
    );
    await user.click(screen.getByRole('radio', { name: /CSV/ }));
    await user.click(screen.getByRole('button', { name: 'Export 412 people' }));
    expect(onExport).toHaveBeenCalledWith({
      who: 'filter',
      fields: ['employee_number'],
      asOf: '2026-09-22',
      format: 'csv',
    });
    expect(await screen.findByText(/Your export is being prepared/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /PDF roster/ }));
    await user.click(screen.getByRole('button', { name: 'Export 412 people' }));
    expect(onExport).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'pdf' }));
  });

  it('cannot export with no fields, and says why People refused', async () => {
    const user = fast();
    render(
      <ExportBuilder
        load={{ status: 'ready', data: asHr }}
        onExport={() => Promise.resolve({ ok: false, message: 'Pay exports need a stated reason' })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Export 412 people' }));
    expect(await screen.findByText('Pay exports need a stated reason')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'HR information' }));
    await user.click(screen.getByRole('checkbox', { name: 'Compensation' }));
    expect(screen.getByRole('button', { name: 'Export 412 people' })).toBeDisabled();
  });

  it('has loading and error states', async () => {
    const { container, rerender } = render(
      <ExportBuilder load={{ status: 'loading' }} onExport={vi.fn()} />,
    );
    expect(screen.getByText('Loading the export builder')).toBeInTheDocument();
    rerender(<ExportBuilder load={{ status: 'error', message: 'Down' }} onExport={vi.fn()} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('hands a scheduled report’s recipient their file, and says when it has gone', async () => {
    const url = 'https://api.kithena.test/v1/exports/files/x?expires=e&sig=s';
    const { container, rerender } = render(
      <ExportBuilder
        load={{
          status: 'ready',
          data: {
            ...asManager,
            ready: {
              status: 'completed',
              expiresAt: '2026-09-23T09:00:00.000Z',
              links: [{ name: 'people-2026-09-22.xlsx', url }],
            },
          },
        }}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Download people-2026-09-22.xlsx' })).toHaveAttribute(
      'href',
      url,
    );
    expect(await axeViolations(container)).toEqual([]);

    rerender(
      <ExportBuilder
        load={{
          status: 'ready',
          data: { ...asManager, ready: { status: 'expired', expiresAt: null, links: [] } },
        }}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByText('This report is no longer available')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
