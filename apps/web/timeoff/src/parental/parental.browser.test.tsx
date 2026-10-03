import { render } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it } from 'vitest';

import { adamCase, parental } from './acme.fixture';
import { ParentalCase } from './case';
import { ParentalPlan } from './plan';

/**
 * T9 and T11 with the real stylesheet, at a desk and on a phone: axe with
 * contrast over the track and the case, and the plan drawn once — on its
 * track where there is room, down the page where there is not.
 */

const shown = (selector: string): boolean =>
  document.querySelector<HTMLElement>(selector)?.offsetParent != null;

it('draws the plan once at either width, and passes axe with contrast', async () => {
  render(<ParentalPlan load={{ status: 'ready', data: parental() }} />);
  const track = shown('[aria-label="Your plan"]');
  const list = shown('[aria-label="Your plan, block by block"]');
  expect(track !== list).toBe(true);
  expect(track).toBe(window.innerWidth >= 640);
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
});

it('draws HR’s case and passes axe with contrast', async () => {
  render(<ParentalCase load={{ status: 'ready', data: adamCase() }} />);
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
});
