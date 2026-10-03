import type { HolidaysData } from '../holidays/holidays';
import type { BalanceData } from './balance';

/**
 * Adam's vacation ledger and Madrid's holidays at Acme on 1 October 2026
 * (`services/timeoff/src/seed/acme.ts`): MT20 and MT21. The ledger is the
 * year's lines that matter on the screen, one of them a correction HR made
 * to the July half day.
 */

const entry = (
  n: number,
  kind: string,
  amount: string,
  effectiveOn: string,
  extra: Partial<BalanceData['entries'][number]> = {},
): BalanceData['entries'][number] => ({
  entryId: `e${String(n)}`,
  kind,
  amount,
  unit: 'day',
  effectiveOn,
  occurredAt: `${effectiveOn}T06:00:00.000Z`,
  reason: null,
  requestId: null,
  supersedes: null,
  ...extra,
});

export const vacation = (): BalanceData => ({
  balance: {
    leaveTypeKey: 'vacation',
    name: 'Vacation',
    unit: 'day',
    colorToken: 'chart-1',
    icon: 'sun',
    left: '11.500',
    used: '10.500',
    booked: '3.000',
    yearly: '25.000',
  },
  entries: [
    entry(1, 'carry_over', '3.000', '2026-01-01'),
    entry(2, 'taken', '-5.000', '2026-02-20', {
      requestId: '0199a000-0000-7000-8000-000000000001',
    }),
    entry(3, 'taken', '-1.000', '2026-07-10', {
      requestId: '0199a000-0000-7000-8000-000000000002',
    }),
    entry(4, 'adjustment', '-0.500', '2026-07-10', {
      occurredAt: '2026-07-14T09:00:00.000Z',
      reason: 'A half day, not a whole one',
      supersedes: 'e3',
    }),
    entry(5, 'taken', '-5.000', '2026-08-07', {
      requestId: '0199a000-0000-7000-8000-000000000003',
    }),
    entry(6, 'booking', '-3.000', '2026-09-21', {
      requestId: '0199a000-0000-7000-8000-000000000011',
    }),
    entry(7, 'accrual', '2.083', '2026-10-01'),
  ],
});

export const madrid = (): HolidaysData => ({
  year: 2026,
  locationKey: 'madrid',
  holidays: [
    { date: '2026-05-01', name: 'Fiesta del Trabajo', layer: 'national', movedFrom: null },
    { date: '2026-10-12', name: 'Fiesta Nacional', layer: 'national', movedFrom: null },
    { date: '2026-11-02', name: 'Todos los Santos', layer: 'regional', movedFrom: '2026-11-01' },
    { date: '2026-11-09', name: 'La Almudena', layer: 'city', movedFrom: null },
    { date: '2026-12-08', name: 'Inmaculada Concepción', layer: 'national', movedFrom: null },
    { date: '2026-12-25', name: 'Navidad', layer: 'national', movedFrom: null },
  ],
  bridges: [
    {
      from: '2026-12-07',
      to: '2026-12-07',
      away: { from: '2026-12-05', to: '2026-12-08', days: 4 },
      holidays: [{ date: '2026-12-08', name: 'Inmaculada Concepción' }],
    },
  ],
  today: '2026-10-01',
});
