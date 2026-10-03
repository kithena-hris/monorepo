// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentPropsWithoutRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let pathname = '/time-off/overview';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentPropsWithoutRef<'a'>) => <a data-next-link="" {...props} />,
}));
vi.mock('../app/(app)/people/actions', () => ({ searchPeople: vi.fn(() => Promise.resolve([])) }));
vi.mock('../app/(app)/settings/shortcuts/actions', () => ({
  saveShortcuts: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock('../app/assistant/actions', () => ({ askAssistant: vi.fn() }));

const { AppShell } = await import('./app-shell');
const { matchRoute, placesFor } = await import('../lib/remotes');
const { EMPTY_SHELL, timeOffCounts, timeOffRoles } = await import('../lib/shell-data');
const timeOff = (await import('../../timeoff/public/routes.json')).default;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  pathname = '/time-off/overview';
});

const nav = matchRoute(timeOff, '/time-off/overview')?.nav ?? {
  sections: [],
  actions: [],
  settings: [],
};

type Viewer = Parameters<typeof timeOffRoles>[1];

/**
 * The shell as Time Off's manifest draws it for somebody with these roles,
 * and what Time Off says of them (`timeOffViewer`), as `shell.ts` cuts it.
 */
function renderShell(roles: { hr: boolean; admin: boolean; finance: boolean }, viewer: Viewer = null) {
  const places = placesFor(nav, timeOffRoles(roles, viewer));
  const counts = timeOffCounts(viewer, places.sections);
  const shell = {
    ...EMPTY_SHELL,
    roles,
    remotes: {
      timeoff: {
        ...places,
        routes: timeOff.routes.map((r) => r.path),
        counts: counts.sections,
        tabCounts: counts.tabs,
      },
    },
  };
  return render(
    <AppShell
      person={{ name: 'Adam Novak', email: 'adam@acme.example' }}
      companyName="Acme"
      entitlements={['module.people', 'module.timeoff']}
      shell={shell}
      // Expanded: the collapsed rail has no room for a section list.
      sidebarCollapsed={false}
    >
      <p>Page</p>
    </AppShell>,
  );
}

const sections = () =>
  within(screen.getByRole('list', { name: 'Time off sections' }))
    .getAllByRole('link')
    .map((a) => a.textContent);

describe('Time off in the shell', () => {
  it('lists an employee’s sections under Time off, without Insights, the current one marked', () => {
    renderShell({ hr: false, admin: false, finance: false });
    expect(sections()).toEqual(['Overview', 'Calendar', 'My requests', 'Attendance']);
    const list = within(screen.getByRole('list', { name: 'Time off sections' }));
    expect(list.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(list.getByRole('link', { name: 'My requests' }).getAttribute('href')).toBe(
      '/time-off/requests/upcoming',
    );
  });

  // TOF-058a: approving is Time Off's fact about the org graph, not a role.
  it('opens the queue to Marco, who approves and holds no admin role, with what waits for him', () => {
    pathname = '/time-off/approvals/waiting';
    renderShell(
      { hr: false, admin: false, finance: false },
      { approves: true, hrAdmin: false, counts: { requestsWaiting: 2, attendanceExceptions: 1 } },
    );
    // Each count is read out after its section: "Requests 2 waiting".
    expect(sections()).toEqual([
      'Overview',
      'Calendar',
      'Requests2 waiting',
      'Attendance1 waiting',
      'Insights',
    ]);
    const list = within(screen.getByRole('list', { name: 'Time off sections' }));
    expect(list.getByRole('link', { name: /^Requests/ }).getAttribute('href')).toBe(
      '/time-off/approvals/waiting',
    );
  });

  it('keeps Adam, who approves nobody, on his own requests, with no queue and no counts', () => {
    pathname = '/time-off/requests/upcoming';
    renderShell(
      { hr: false, admin: false, finance: false },
      { approves: false, hrAdmin: false, counts: { requestsWaiting: 0, attendanceExceptions: 0 } },
    );
    expect(sections()).toEqual(['Overview', 'Calendar', 'My requests', 'Attendance']);
    expect(screen.queryByText(/waiting/)).toBeNull();
  });

  it('gives HR Insights, and their Requests open on what waits for them', () => {
    pathname = '/time-off/approvals/decided';
    renderShell({ hr: true, admin: false, finance: false });
    expect(sections()).toEqual(['Overview', 'Calendar', 'Requests', 'Attendance', 'Insights']);
    const requests = within(screen.getByRole('list', { name: 'Time off sections' })).getByRole(
      'link',
      { name: 'Requests' },
    );
    expect(requests.getAttribute('href')).toBe('/time-off/approvals/waiting');
    expect(requests.getAttribute('aria-current')).toBe('page');
  });

  it('puts Time off between Home and People in the phone’s tab bar', () => {
    renderShell({ hr: false, admin: false, finance: false });
    const tabs = within(screen.getByRole('navigation', { name: 'Main, compact' }));
    expect(tabs.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Home',
      'Time off',
      'People',
      'Inbox',
      'Me',
    ]);
    expect(tabs.getByRole('link', { name: 'Time off' }).getAttribute('href')).toBe(
      '/time-off/overview',
    );
  });
});
