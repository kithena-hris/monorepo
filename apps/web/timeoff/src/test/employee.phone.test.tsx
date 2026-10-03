import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { madrid, vacation } from '../balance/acme.fixture';
import { Balance, Holidays, RequestDetail, RequestTimeOff } from '../index';
import { december, october, opening } from '../request/acme.fixture';
import type { RequestData } from '../request/request';
import { approved } from '../requests/acme.fixture';
import { underFloor } from './floor';

/**
 * The employee's screens on a phone (MT5–MT7, MT9, MT10, MT20, MT21): 390×844,
 * a finger, the real stylesheet. Each state passes axe with contrast, and
 * every target a finger has to hit clears 44px.
 */

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
const shown = (text: string): boolean =>
  screen.queryAllByText(text).some((el) => el.checkVisibility());
/** Until a sheet has slid in: measured mid-flight, it is still below the screen. */
async function settled(): Promise<void> {
  const finite = document
    .getAnimations()
    .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
  await Promise.all(finite.map((a) => a.finished));
}
async function clean(): Promise<void> {
  await settled();
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(
    result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
}
const at = (data: RequestData, step: 'type' | 'dates' | 'review'): RequestData => ({
  ...data,
  asked: { ...data.asked, step },
});

describe('requesting on a phone', () => {
  it('opens on MT5’s sheet of types, the dates still to come', async () => {
    render(<RequestTimeOff load={ready(opening())} />);
    expect(shown('Vacation')).toBe(true);
    expect(shown('11.5 days left')).toBe(true);
    expect(screen.queryByRole('group', { name: 'Dates off' })).toBeNull();
    await clean();
  });

  it('picks the dates full screen, MT6, the count and the balance after in the bar', async () => {
    render(<RequestTimeOff load={ready(at(october(), 'dates'))} />);
    expect(screen.getByRole('group', { name: 'Dates off' }).checkVisibility()).toBe(true);
    expect(shown('11.5 days left')).toBe(false);
    expect(shown('19–23 Oct')).toBe(true);
    expect(shown('5 days · 6.5 left after')).toBe(true);
    await settled();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next.checkVisibility()).toBe(true);
    // The bar is at the bottom of the screen, not scrolled out of reach.
    expect(next.getBoundingClientRect().bottom).toBeLessThanOrEqual(844);
    await clean();
  });

  it('reviews, MT7: how much is left, who else is off, the clash, and send', async () => {
    render(<RequestTimeOff load={ready(at(october(), 'review'))} />);
    expect(shown('Who else is off')).toBe(true);
    expect(screen.queryByRole('group', { name: 'Dates off' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send to Marco' }).checkVisibility()).toBe(true);
    expect(screen.getByRole('button', { name: 'Dates' }).checkVisibility()).toBe(true);
    await clean();
  });

  it('below zero, MT9: borrow, unpaid or shorten, and send to Marco and HR', async () => {
    render(<RequestTimeOff load={ready(at(december(), 'review'))} />);
    expect(shown('Borrow 1.5 days from 2027')).toBe(true);
    expect(screen.getByRole('button', { name: 'Send to Marco and HR' }).checkVisibility()).toBe(
      true,
    );
    await clean();
  });
});

describe('the rest on a phone', () => {
  it('opens a request alone, MT10, with its timeline and the way to change it', async () => {
    render(<RequestDetail load={ready(approved())} />);
    expect(shown('Approved by your manager')).toBe(true);
    // The list is the desk's second column, not the phone's.
    const rows = [...document.querySelectorAll('a[href^="/time-off/requests/"]')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => !a.checkVisibility())).toBe(true);
    await clean();
  });

  it('shows where the days went, MT20', async () => {
    render(<Balance load={ready(vacation())} />);
    expect(shown('Earned in October')).toBe(true);
    await clean();
  });

  it('lists the holidays where Adam works, MT21', async () => {
    render(<Holidays load={ready(madrid())} />);
    expect(shown('Fiesta Nacional')).toBe(true);
    expect(screen.getByRole('button', { name: 'Add to my calendar' }).checkVisibility()).toBe(true);
    await clean();
  });
});
