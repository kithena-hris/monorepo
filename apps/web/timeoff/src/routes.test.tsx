import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import manifest from '../public/routes.json';
import * as screens from './index';
import { axeViolations } from './test/axe';

const routes = new Set(manifest.routes.map((r) => r.path));
const places = [...manifest.sections, ...manifest.actions, ...manifest.settings];

describe('routes.json', () => {
  it('points every route at a screen index.ts exports', () => {
    const exported = new Set(Object.keys(screens));
    const missing = manifest.routes.filter((r) => !exported.has(r.component));
    expect(missing).toEqual([]);
  });

  it('lists every place, tab and owned path as a route of its own', () => {
    const paths = places.flatMap((p) => [
      p.path,
      ...('owns' in p ? p.owns : []),
      ...('tabs' in p ? p.tabs.flatMap((t) => t.path) : []),
    ]);
    expect(paths.filter((p) => !routes.has(p))).toEqual([]);
  });

  it('fills the shell’s places with exports too', () => {
    const exported = new Set(Object.keys(screens));
    expect(Object.values(manifest.slots).filter((c) => !exported.has(c))).toEqual([]);
  });

  it('starts each umbrella section at its first tab', () => {
    for (const s of manifest.sections) {
      if ('tabs' in s) expect(s.path).toBe(s.tabs[0]?.path);
    }
  });
});

describe('a placeholder screen', () => {
  it('opens with the host’s trail, its title and the section’s tabs, over a skeleton', async () => {
    const { container } = render(
      <screens.Approvals
        frame={{
          section: 'Requests',
          tabs: [
            { href: '/time-off/approvals/waiting', label: 'Waiting for me', current: true },
            { href: '/time-off/approvals/decided', label: 'Decided', current: false },
          ],
        }}
      />,
    );
    const trail = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(trail.getByRole('link', { name: 'Time off' }).getAttribute('href')).toBe('/time-off');
    expect(screen.getByRole('heading', { level: 1, name: 'Requests' })).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Requests tabs' }));
    expect(tabs.getByRole('link', { name: 'Decided' }).getAttribute('href')).toBe(
      '/time-off/approvals/decided',
    );
    expect(screen.getByRole('status').textContent).toContain('Loading Requests');
    expect(await axeViolations(container)).toEqual([]);
  });
});
