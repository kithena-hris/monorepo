import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { adaSeptember } from './acme.fixture';
import { PayPeriod } from './pay-period';

/** Closing September for Payroll (T24) on Acme's demo data, the morning after it ends. */

const ready = (over: Partial<ReturnType<typeof adaSeptember>> = {}) => ({
  status: 'ready' as const,
  data: { ...adaSeptember(), ...over },
});
const ok = () => vi.fn(() => Promise.resolve({ ok: true as const }));

describe('closing the month', () => {
  it('shows each team and the month’s totals for Payroll', async () => {
    const { container } = render(<PayPeriod load={ready()} onClose={ok()} onRemind={ok()} />);
    expect(screen.getByText('September 2026 · ready to send to Payroll')).toBeTruthy();
    const rows = within(screen.getByRole('table', { name: 'Teams' })).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'TeamPeopleTimesheetsOvertimePaid as',
      'Design22Ready4hComp time',
      'Engineering148Ready62hComp time',
      'Finance19Ready0h—',
      'Support412 waiting31hPaid',
    ]);
    const send = within(
      screen.getByRole('heading', { name: 'Send to Payroll' }).closest('section') as HTMLElement,
    );
    expect(send.getByText('49h')).toBeTruthy();
    expect(send.getByText('66h')).toBeTruthy();
    expect(send.getByText('3 days, 2 people')).toBeTruthy();
    expect(send.getByText('2 people, 1.5 days below zero')).toBeTruthy();
    expect(send.getByText(/never punch times or locations/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('flags who is late and reminds them, then sends September', async () => {
    const onClose = ok();
    const onRemind = ok();
    render(<PayPeriod load={ready()} onClose={onClose} onRemind={onRemind} />);
    expect(screen.getByText('Support has 2 people waiting')).toBeTruthy();
    expect(
      screen.getByText(
        /Diego Alvarez: 1 missing clock-out\. Lucía Romero: 1h 15m overtime to decide/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remind them' }));
    expect(onRemind).toHaveBeenCalledWith('2026-09', null);
    expect(await screen.findByText('Reminded 2 people and their managers')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send September to Payroll' }));
    expect(onClose).toHaveBeenCalledWith('2026-09');
  });

  it('holds the send until the month is over', () => {
    render(
      <PayPeriod
        load={ready({
          month: '2026-10',
          from: '2026-10-01',
          to: '2026-10-31',
          late: [],
          teams: [],
        })}
        onClose={ok()}
      />,
    );
    expect(screen.getByText('October 2026 · closes for Payroll after Sat 31 Oct')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send October to Payroll' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('says a sent month is with Payroll, and offers nothing to send', () => {
    render(
      <PayPeriod load={ready({ closedAt: '2026-10-05T08:00:00.000Z', late: [] })} onClose={ok()} />,
    );
    expect(screen.getByText('September is with Payroll')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /to Payroll$/ })).toBeNull();
  });

  it('loads in the page’s shape', async () => {
    const { container } = render(<PayPeriod load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading the pay period');
    expect(await axeViolations(container)).toEqual([]);
  });
});
