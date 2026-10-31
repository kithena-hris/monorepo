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

  it('keeps every section to three tabs at most', () => {
    for (const s of manifest.sections) {
      if ('tabs' in s) expect(s.tabs.length).toBeLessThanOrEqual(3);
    }
  });

  it('starts each umbrella section at its first tab', () => {
    for (const s of manifest.sections) {
      if ('tabs' in s) expect(s.path).toBe(s.tabs[0]?.path);
    }
  });
});

describe('the frame', () => {
  const frame = {
    section: 'Attendance',
    description: 'Clocked hours, breaks and overtime',
    tabs: [
      { href: '/time-off/attendance/now', label: 'Today', current: false },
      { href: '/time-off/attendance/timesheet', label: 'My week', current: true },
    ],
    actions: [
      { href: '/time-off/attendance/requests', label: 'Overtime and corrections', menu: true },
      { href: '/time-off/attendance/kiosk-code', label: 'Kiosk code', menu: true },
    ],
  };

  it('gives every tab the section’s title and line, and puts what is not the page’s one thing under More', async () => {
    const { container } = render(<screens.Timesheet load={{ status: 'loading' }} frame={frame} />);
    const trail = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(trail.getByRole('link', { name: 'Time off' }).getAttribute('href')).toBe('/time-off');
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    expect(screen.getByText('Clocked hours, breaks and overtime')).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Attendance tabs' }));
    expect(tabs.getByRole('link', { name: 'Today' }).getAttribute('href')).toBe(
      '/time-off/attendance/now',
    );
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Kiosk code' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws no row of tabs for a section with one tab', () => {
    render(
      <screens.Timesheet
        load={{ status: 'loading' }}
        frame={{
          ...frame,
          tabs: [{ href: '/time-off/attendance/timesheet', label: 'My week', current: true }],
        }}
      />,
    );
    expect(screen.queryByRole('navigation', { name: 'Attendance tabs' })).toBeNull();
  });
});
