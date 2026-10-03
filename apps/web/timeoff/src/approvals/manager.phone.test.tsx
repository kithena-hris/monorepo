import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Approvals, TeamCalendar } from '../index';
import { adam, deciding, october, waiting } from './acme.fixture';

/**
 * The manager's screens at 390×844 with a coarse pointer and the real
 * stylesheet (MT13–MT16): axe with contrast, every tap target against the
 * 44px floor, and what a phone shows that a desk does not, or the other way.
 */

const FLOOR = 44;

/** Targets under the floor, by name and size. A `::before` hit area counts, as Reach draws one. */
function underFloor(root: Element): string[] {
  return [...root.querySelectorAll<HTMLElement>('button, a[href], [role="checkbox"]')].flatMap(
    (el) => {
      if (el.closest('[aria-hidden="true"], [inert]') !== null) return [];
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return [];
      const hit = getComputedStyle(el, '::before');
      const width = Math.max(box.width, Number.parseFloat(hit.width) || 0);
      const height = Math.max(box.height, Number.parseFloat(hit.height) || 0);
      if (width >= FLOOR - 0.5 && height >= FLOOR - 0.5) return [];
      const name = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
      return [
        `${el.tagName.toLowerCase()} "${name}" ${String(Math.round(width))}×${String(Math.round(height))}`,
      ];
    },
  );
}

const shown = (el: Element | null): boolean =>
  el instanceof HTMLElement && el.checkVisibility() && el.getBoundingClientRect().height > 0;

async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

const frame = {
  section: 'Requests',
  tabs: [
    {
      href: '/time-off/approvals/waiting',
      label: 'Waiting for me',
      short: 'Waiting',
      current: true,
      count: 5,
    },
    { href: '/time-off/approvals/coming-up', label: 'Coming up', current: false },
  ],
};

describe('approvals on a phone', () => {
  it('MT15: the two groups, one tap for the clear ones, rows that open', async () => {
    render(
      <Approvals
        load={{ status: 'ready', data: waiting() }}
        path="/time-off/approvals/waiting"
        onApprove={() => Promise.resolve({ ok: true })}
        onDecide={() => Promise.resolve({ ok: true })}
        frame={frame}
      />,
    );
    expect(shown(screen.getByRole('button', { name: 'Approve all 3' }))).toBe(true);
    // The desk's checkboxes and per-row buttons are not under a thumb.
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Approve Leo Rossi’s request' })).toBeNull();
    expect(await violations()).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });

  it('MT16: the request replaces the list, its working week and the actions', async () => {
    render(
      <Approvals
        load={{ status: 'ready', data: deciding() }}
        path={`/time-off/approvals/waiting/${adam.requestId}`}
        onDecide={() => Promise.resolve({ ok: true })}
        frame={frame}
      />,
    );
    expect(shown(screen.getByRole('heading', { name: 'Adam Novak · vacation' }))).toBe(true);
    const week = screen.getByRole('region', { name: 'Platform, the week of Mon 19 Oct' });
    expect(shown(week)).toBe(true);
    // Five days, Monday to Friday: a phone is passed fewer, not a smaller picture.
    expect(week.style.getPropertyValue('--reach-columns')).toBe('5');
    expect(screen.queryByRole('region', { name: 'Platform around 19–23 Oct' })).toBeNull();
    expect(shown(screen.getByRole('button', { name: 'Approve' }))).toBe(true);
    expect(await violations()).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });
});

describe('the calendar on a phone', () => {
  it('MT13: a working week of the team, a week at a time', async () => {
    render(
      <TeamCalendar
        load={{ status: 'ready', data: october() }}
        path="/time-off/calendar/month"
        query={{}}
        frame={{ section: 'Calendar' }}
      />,
    );
    const week = screen.getByRole('region', { name: 'The week of 28 Sept – 2 Oct' });
    expect(shown(week)).toBe(true);
    expect(week.querySelectorAll('button[aria-pressed]').length).toBe(5);
    expect(screen.queryByRole('region', { name: 'October 2026' })).toBeNull();
    expect(shown(screen.getByRole('button', { name: 'Next week' }))).toBe(true);
    expect(await violations()).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
  });

  it('MT14: a tapped day opens as a sheet', async () => {
    render(
      <TeamCalendar
        load={{ status: 'ready', data: { ...october(), week: '2026-10-19' } }}
        path="/time-off/calendar/month"
        query={{ day: '2026-10-21' }}
        frame={{ section: 'Calendar' }}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Wednesday 21 October' });
    expect(shown(sheet)).toBe(true);
    expect(sheet.textContent).toContain('4 of 7 in');
    expect(await violations()).toEqual([]);
  });
});
