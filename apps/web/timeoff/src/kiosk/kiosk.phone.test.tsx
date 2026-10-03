import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it, vi } from 'vitest';

import { Kiosk, KioskCode } from '../index';
import { underFloor } from '../test/floor';

/**
 * The kiosk code on Adam's phone, and the kiosk itself under a finger, with
 * the real stylesheet: axe with contrast, and every target at 44px or more.
 */

async function clean(): Promise<void> {
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(
    result.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(',')}`),
  ).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
}

it('shows the kiosk code across the phone, with nothing to scroll sideways', async () => {
  render(
    <KioskCode
      load={{
        status: 'ready',
        data: {
          token: 'kq_a-test-code',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          personId: 'p-adam',
        },
      }}
      onRefresh={vi.fn()}
      onSavePin={vi.fn()}
    />,
  );
  const code = screen.getByRole('img', { name: 'Your kiosk code' });
  expect(code.getBoundingClientRect().width).toBeGreaterThan(200);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await clean();
});

it('draws the kiosk dark, with its buttons big enough for a finger', async () => {
  render(
    <Kiosk
      place="Madrid office, main entrance"
      online={false}
      onIdentify={vi.fn()}
      onPunch={vi.fn()}
      timeZone="Europe/Madrid"
    />,
  );
  expect(screen.getByText('Offline')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Use a PIN' })).toBeTruthy();
  await clean();
});
