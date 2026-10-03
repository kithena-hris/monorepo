import { render } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it } from 'vitest';

import { Insights, Overview, ParentalCase, ParentalPlan } from '../index';
import { adam } from '../overview/acme.fixture';
import { adamCase, parental } from '../parental/acme.fixture';
import { underFloor } from './floor';

/**
 * The screens at 390×844 with a coarse pointer and the real stylesheet: axe
 * over the rendered page, contrast included, and every tap target measured
 * against the 44px floor. People's phone suite, for Time Off; each screen
 * ticket adds its own states here.
 */

it('draws a placeholder under a phone’s bar, its tabs as pills, every target reachable', async () => {
  render(
    <Insights
      frame={{
        section: 'Insights',
        siblings: [
          {
            label: 'Time off',
            items: [
              { href: '/time-off/overview', label: 'Overview', icon: 'overview' },
              { href: '/time-off/insights/what-changed', label: 'Insights', current: true },
            ],
          },
        ],
        tabs: [
          { href: '/time-off/insights/what-changed', label: 'What changed', current: true },
          { href: '/time-off/insights/balances', label: 'Balances', current: false },
        ],
        actions: [{ href: '/time-off/request', label: 'Request time off', icon: 'add' }],
      }}
    />,
  );
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});

it('draws the overview as MT1: the clock, balances to swipe, one suggestion, what is coming up', async () => {
  render(
    <Overview
      load={{ status: 'ready', data: adam() }}
      onPunch={() => Promise.resolve({ ok: true })}
      frame={{
        section: 'Overview',
        siblings: [
          {
            label: 'Time off',
            items: [
              { href: '/time-off/overview', label: 'Overview', icon: 'overview', current: true },
              { href: '/time-off/requests/upcoming', label: 'My requests' },
            ],
          },
        ],
        actions: [{ href: '/time-off/request', label: 'Request time off', icon: 'add' }],
      }}
    />,
  );
  const visible = (name: RegExp | string): boolean =>
    [...document.querySelectorAll('h1, h2, h3')].some(
      (h) =>
        (typeof name === 'string' ? h.textContent === name : name.test(h.textContent)) &&
        (h as HTMLElement).offsetParent !== null,
    );
  expect(visible(/^Good afternoon, Adam$/)).toBe(true);
  expect(visible('Coming up')).toBe(true);
  // The desk's: the team and the parental plan.
  expect(visible('Your team today')).toBe(false);
  const balances = document.querySelector('[aria-label="Your balances"] [aria-live]');
  expect(balances !== null && balances.scrollWidth > balances.clientWidth).toBe(true);
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});

/** Whether a heading or a list is drawn, not just in the page. */
const shown = (el: Element | null): boolean =>
  el !== null && (el as HTMLElement).offsetParent !== null;
const parentalFrame = {
  section: 'Overview',
  siblings: [
    {
      label: 'Time off',
      items: [{ href: '/time-off/overview', label: 'Overview', icon: 'overview', current: true }],
    },
  ],
};

it('draws the plan as MT11: the blocks down the page, the track the desk’s', async () => {
  render(<ParentalPlan load={{ status: 'ready', data: parental() }} frame={parentalFrame} />);
  expect(shown(document.querySelector('[aria-label="Your plan, block by block"]'))).toBe(true);
  expect(shown(document.querySelector('[aria-label="Your plan"]'))).toBe(false);
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});

it('draws the handover as MT12, every target reachable', async () => {
  render(
    <ParentalPlan
      load={{ status: 'ready', data: parental({ step: 'handover' }) }}
      onHandover={() => Promise.resolve({ ok: true })}
      frame={parentalFrame}
    />,
  );
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});

it('draws the four questions under a finger, every target reachable', async () => {
  render(
    <ParentalPlan
      load={{ status: 'ready', data: parental({ plan: null, step: 'about' }) }}
      onAnswer={() => Promise.resolve({ ok: true })}
      frame={parentalFrame}
    />,
  );
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});

it('draws HR’s case on a phone, every target reachable', async () => {
  render(
    <ParentalCase
      load={{ status: 'ready', data: adamCase() }}
      onApprove={() => Promise.resolve({ ok: true })}
      frame={{ section: 'Requests' }}
    />,
  );
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});
