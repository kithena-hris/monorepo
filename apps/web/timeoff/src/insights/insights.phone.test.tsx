import { render } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it } from 'vitest';

import { Insights } from '../index';
import { underFloor } from '../test/floor';
import { adaInsights, adaNudging } from './acme.fixture';
import type { InsightsData } from './insights';

/**
 * Insights (T27) at 390×844 with a coarse pointer and the real stylesheet:
 * every tab and an open point, axe with contrast, the 44px floor, and
 * nothing wider than the phone.
 */

const states: readonly (readonly [string, Partial<InsightsData>])[] = [
  ['what changed', {}],
  ['the people behind a point', { point: 'no_break' }],
  ['time off', { tab: 'time-off' }],
  ['attendance', { tab: 'attendance' }],
  ['balances', { tab: 'balances' }],
];

it('draws the nudge as a sheet on a phone, every target reachable', async () => {
  render(<Insights load={{ status: 'ready', data: adaNudging() }} onAsk={() => undefined} />);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});

for (const [name, over] of states) {
  it(`draws ${name} on a phone`, async () => {
    render(<Insights load={{ status: 'ready', data: adaInsights(over) }} />);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(
      result.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(',')}`),
    ).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });
}
