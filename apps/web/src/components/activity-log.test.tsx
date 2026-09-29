// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activityFilters, type ActivityEntry } from '../lib/activity';
import { ActivityLog } from './activity-log';

/*
 * Settings › Activity: who is named how, support's actions carry the sign-in
 * they came from, and every filter is a new address the server answers.
 */

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const GRACE = '00000000-0000-4000-8000-0000000000a2';

const base: ActivityEntry = {
  id: '01890000-0000-7000-8000-000000000001',
  occurredAt: '2026-09-29T10:20:00.000Z',
  module: 'people',
  area: 'roles',
  action: 'Granted a role',
  detail: null,
  actorKind: 'person',
  actorAccountId: ADA_ACCOUNT,
  onBehalfOf: null,
  operatorLabel: null,
  subjectKind: 'setting',
  subjectId: null,
  subjectLabel: 'HR',
  reason: null,
  supportSignIn: null,
};

const entries: ActivityEntry[] = [
  base,
  {
    ...base,
    id: '01890000-0000-7000-8000-000000000002',
    actorKind: 'support',
    actorAccountId: '00000000-0000-4000-8000-0000000000a9',
    onBehalfOf: '6a30103a-b9d3-4e3e-8e07-5a5ea8d77d71',
    operatorLabel: 'jane@kithena.com',
    action: 'Added a field',
    subjectLabel: 'Work phone',
    supportSignIn: { entryId: 'x', at: '2026-09-29T10:00:00.000Z', reason: 'Ticket 4411' },
  },
  {
    ...base,
    id: '01890000-0000-7000-8000-000000000003',
    area: 'sensitive_access',
    action: 'Read an identifier in full',
    actorKind: 'system',
    actorAccountId: null,
    subjectKind: 'person',
    subjectId: GRACE,
    subjectLabel: null,
  },
];

const named = {
  [ADA_ACCOUNT]: { name: 'Ada Lovelace', avatarUrl: null, personId: 'p1' },
  [GRACE]: { name: 'Grace Hopper', avatarUrl: null, personId: GRACE },
};

beforeEach(() => {
  window.history.replaceState(null, '', '/settings/activity?area=roles');
  router.push.mockReset();
});
afterEach(cleanup);

describe('Settings › Activity', () => {
  it('names people, Kithena support and the system, and whose record', () => {
    render(
      <ActivityLog
        load={{ status: 'ready', page: { entries, next: null } }}
        named={named}
        filters={activityFilters({ area: 'roles' })}
      />,
    );
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kithena support (jane@kithena.com)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('System').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0);
  });

  it('shows which sign-in support’s action came from, and why', () => {
    render(
      <ActivityLog
        load={{ status: 'ready', page: { entries: [entries[1] as ActivityEntry], next: null } }}
        named={named}
        filters={activityFilters({})}
      />,
    );
    for (const opener of screen.getAllByRole('button', { name: /show|expand|detail/i })) {
      fireEvent.click(opener);
    }
    expect(screen.getByText(/for: Ticket 4411/)).toBeTruthy();
  });

  it('puts a filter in the address and starts again from the newest', () => {
    window.history.replaceState(null, '', '/settings/activity?area=roles&before=x');
    render(
      <ActivityLog
        load={{ status: 'ready', page: { entries, next: null } }}
        named={named}
        filters={activityFilters({ area: 'roles', before: 'x' })}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Kithena support' }));
    expect(router.push).toHaveBeenCalledWith('/settings/activity?area=roles&by=support', {
      scroll: false,
    });
  });

  it('says the log is not available yet, rather than an error, while it is not deployed', () => {
    render(<ActivityLog load={{ status: 'unavailable' }} named={{}} filters={activityFilters({})} />);
    expect(screen.getByText('The activity log isn’t available yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells somebody who may not read it why, rather than showing an empty log', () => {
    render(
      <ActivityLog
        load={{ status: 'forbidden' }}
        named={{}}
        filters={activityFilters({})}
      />,
    );
    expect(screen.getByText('The activity log is for administrators and HR')).toBeTruthy();
  });
});
