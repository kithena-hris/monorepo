import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it } from 'vitest';

import { Integrations } from '../index';
import { underFloor } from '../test/floor';

/** T35 at 390×844 with the real stylesheet: axe with contrast, and every target at 44px. */

it('lists the integrations on a phone, with nothing to scroll sideways', async () => {
  render(
    <Integrations
      load={{
        status: 'ready',
        data: {
          integrations: [
            {
              provider: 'google',
              kind: 'calendar',
              available: true,
              configured: true,
              connected: false,
              connectedAt: null,
              account: null,
            },
            {
              provider: 'slack',
              kind: 'chat',
              available: true,
              configured: false,
              connected: false,
              connectedAt: null,
              account: null,
            },
          ],
          kiosks: [],
          locations: [{ locationKey: 'madrid', name: null }],
          packs: [{ country: 'ES', reviewed: false, inUse: true }],
          modules: [{ key: 'payroll', events: ['timeoff.period.closed'] }],
          chatAnswers: { namesPrivateLeave: false },
        },
      }}
    />,
  );
  expect(screen.getByText('Google Calendar')).toBeTruthy();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(result.violations.map((v) => v.id)).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
});
