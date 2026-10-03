import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import type { JSX } from 'react';
import { expect, it } from 'vitest';

import { AttendanceRequests, Exceptions, PayPeriod } from '../index';
import { underFloor } from '../test/floor';
import { adaExceptions, adaSeptember, marcoRequests } from './acme.fixture';

/**
 * HR's and the managers' attendance pages at 390×844 with a coarse pointer
 * and the real stylesheet (T23, T24, the Requests tab): axe over the page,
 * contrast included, every tap target against the 44px floor, and nothing
 * wider than the phone.
 */

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
const ok = (): Promise<{ ok: true }> => Promise.resolve({ ok: true });

const screens: readonly (readonly [string, () => JSX.Element])[] = [
  ['exceptions', () => <Exceptions load={ready(adaExceptions())} />],
  ['exceptions, loading', () => <Exceptions load={{ status: 'loading' }} />],
  ['the pay period', () => <PayPeriod load={ready(adaSeptember())} onClose={ok} onRemind={ok} />],
  ['the pay period, loading', () => <PayPeriod load={{ status: 'loading' }} />],
  ['the Requests tab', () => <AttendanceRequests load={ready(marcoRequests())} onDecide={ok} />],
];

it('decides overtime in a dialog on a phone, every target reachable', async () => {
  render(<AttendanceRequests load={ready(marcoRequests())} onDecide={ok} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Decide Omar Haddad’s overtime on Tue 29 Sept' }),
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});

for (const [name, draw] of screens) {
  it(`draws ${name} on a phone`, async () => {
    render(draw());
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(
      result.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(',')}`),
    ).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });
}
