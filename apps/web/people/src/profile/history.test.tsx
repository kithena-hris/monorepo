import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import type { RecordField } from '../record/model';
import { axeViolations } from '../test/axe';
import { PersonHistory, type HistoryState } from './history';

/** A `PageSection`, by its heading. */
const section = (name: string): HTMLElement =>
  screen.getByRole('heading', { name }).closest('section') as HTMLElement;

const field = (over: Partial<RecordField> & Pick<RecordField, 'key' | 'label'>): RecordField => ({
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  readOnly: true,
  ...over,
});

const change = (over: Partial<HistoryState['changes'][number]> & { id: string; key: string }) => ({
  value: null,
  effectiveFrom: '2026-03-01',
  recordedAt: '2026-03-15T09:12:00.000Z',
  by: 'Priya Shah',
  supersedes: null,
  supersededBy: null,
  ...over,
});

/**
 * March's salary, typed wrong and corrected in June: HR reading it as of 15
 * April. The correction is its own row naming the one it replaces.
 */
const march: HistoryState = {
  person: { id: 'p', name: 'Adam Reyes' },
  asOf: '2026-04-15',
  sections: [
    {
      key: 'compensation',
      label: 'Compensation',
      visibility: ['self', 'hr'],
      fields: [
        field({ key: 'base_salary', label: 'Base salary', dataType: 'money' }),
        field({ key: 'iban', label: 'IBAN', dataType: 'bank_account' }),
      ],
    },
    {
      key: 'contact',
      label: 'Contact',
      visibility: ['self', 'hr'],
      fields: [field({ key: 'mobile', label: 'Mobile', dataType: 'phone' })],
    },
  ],
  dated: ['base_salary'],
  values: { base_salary: { amountMinor: '5100000', currency: 'EUR' } },
  changes: [
    change({
      id: 'june',
      key: 'base_salary',
      value: { amountMinor: '6000000', currency: 'EUR' },
      effectiveFrom: '2026-06-01',
      recordedAt: '2026-05-20T10:00:00.000Z',
    }),
    change({
      id: 'fix',
      key: 'base_salary',
      value: { amountMinor: '5100000', currency: 'EUR' },
      recordedAt: '2026-06-02T08:30:00.000Z',
      by: 'You',
      supersedes: 'typo',
    }),
    change({
      id: 'typo',
      key: 'base_salary',
      value: { amountMinor: '5000000', currency: 'EUR' },
      supersededBy: 'fix',
    }),
    change({ id: 'bank', key: 'iban', value: { last4: null } }),
    change({ id: 'phone', key: 'mobile', value: '+34 612 345 678', effectiveFrom: '2026-03-15' }),
  ],
};

describe('PersonHistory', () => {
  it('reads the record as of the date, with a correction shown as superseding (PEO-064)', async () => {
    const { container } = render(
      <PersonHistory load={{ status: 'ready', data: march }} onAsOf={vi.fn()} />,
    );
    const compensation = section('Compensation');
    expect(within(compensation).getByText(/51,000\.00/)).toBeInTheDocument();
    // A phone number has no value on a past day, only its changes.
    expect(within(section('Contact')).getByText('Not kept by date')).toBeInTheDocument();

    // Newest first, by the day each was made.
    const days = screen.getAllByRole('list', { name: /^Changes, / });
    expect(days.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Changes, June 2, 2026',
      'Changes, May 20, 2026',
      'Changes, March 15, 2026',
    ]);
    const [fix] = within(days[0] as HTMLElement).getAllByRole('listitem');
    expect(fix).toHaveTextContent('Base salary corrected');
    expect(within(fix as HTMLElement).getByText('Correction')).toBeInTheDocument();
    // From what it replaced, to what it is.
    expect(fix).toHaveTextContent(/50,000\.00.*to.*51,000\.00/);
    expect(fix).toHaveTextContent('By You');
    const [june] = within(days[1] as HTMLElement).getAllByRole('listitem');
    // Recorded on the 20th of May, in force from the 1st of June: both said.
    expect(june).toHaveTextContent('effective June 1, 2026');
    const march15 = within(days[2] as HTMLElement).getAllByRole('listitem');
    const typo = march15.find((li) => li.textContent.includes('Superseded'));
    expect(typo).toBeDefined();
    // Sealed: that it changed, never what to.
    expect(march15.some((li) => li.textContent.includes('••••'))).toBe(true);
    // Recorded the day it took effect: one date, not two.
    const phone = march15.find((li) => li.textContent.includes('Mobile'));
    expect(phone).not.toHaveTextContent('effective');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws who made each change: their photo, or the product itself', () => {
    render(
      <PersonHistory
        load={{
          status: 'ready',
          data: {
            ...march,
            asOf: null,
            changes: [
              change({
                id: 'auto',
                key: 'mobile',
                value: '+34 600',
                effectiveFrom: '2026-03-15',
                by: 'Automatically',
                actor: { kind: 'system', avatarUrl: null },
              }),
            ],
          },
        }}
        onAsOf={vi.fn()}
      />,
    );
    const [item] = screen.getAllByRole('listitem');
    expect(item).toHaveTextContent('Mobile added');
    expect(item).toHaveTextContent('Done automatically');
  });

  it('narrows to one field, and goes back to today', async () => {
    const user = fast();
    const onAsOf = vi.fn();
    render(<PersonHistory load={{ status: 'ready', data: march }} onAsOf={onAsOf} />);
    await user.click(screen.getByRole('combobox', { name: 'Field' }));
    await user.click(await screen.findByRole('option', { name: 'Mobile' }));
    expect(screen.queryByRole('heading', { name: 'Compensation' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(onAsOf).toHaveBeenCalledWith(null);
  });

  it('shows today as the changes alone, without the as-of notice or the record', () => {
    render(
      <PersonHistory
        load={{
          status: 'ready',
          data: { ...march, asOf: null, values: { ...march.values, mobile: '+34 612 345 678' } },
        }}
        onAsOf={vi.fn()}
      />,
    );
    expect(screen.queryByText(/As it stood on/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Contact' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Changes' })).toBeInTheDocument();
  });

  it('has loading and error states', async () => {
    const { container, rerender } = render(
      <PersonHistory load={{ status: 'loading' }} onAsOf={vi.fn()} />,
    );
    expect(screen.getByText('Loading this history')).toBeInTheDocument();
    rerender(<PersonHistory load={{ status: 'error', message: 'Not found' }} onAsOf={vi.fn()} />);
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
