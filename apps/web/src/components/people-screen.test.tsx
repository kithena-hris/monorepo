// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The host's half of "the filters are in the address": what each screen is
 * handed from the address, and what each of its callbacks does to it. The
 * screen itself is a remote; here it is a stand-in that keeps its props.
 */

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
// Server actions: none is called by these tests.
vi.mock('../app/(app)/people/actions', () => ({
  decidePendingChange: vi.fn(),
  withdrawPendingChange: vi.fn(),
  approveAlone: vi.fn(),
  saveSegment: vi.fn(),
  directoryPage: vi.fn(),
}));
let shown: Record<string, unknown> = {};
vi.mock('./remote-screen', () => ({
  RemoteScreen: ({ props }: { props: Record<string, unknown> }) => {
    shown = props;
    return null;
  },
}));

const { PeopleScreen } = await import('./people-screen');

/** The screen at `url`, and the props it was handed. */
function open(url: string, component: string): Record<string, unknown> {
  window.history.replaceState(null, '', url);
  render(
    <PeopleScreen
      route={{ entry: 'x', component }}
      load={{ status: 'ready', data: {} }}
      params={{}}
      search={Object.fromEntries(new URLSearchParams(window.location.search))}
      today="2026-09-29"
    />,
  );
  return shown;
}

const call = (props: Record<string, unknown>, name: string, ...args: unknown[]): void => {
  (props[name] as (...a: unknown[]) => void)(...args);
};
const here = (): string => window.location.pathname + window.location.search;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('a screen that narrows what it already has', () => {
  it('restores a tab from the address, and ignores one it does not know', () => {
    expect(open('/people/approvals?tab=asked', 'Approvals')['tab']).toBe('asked');
    cleanup();
    expect(open('/people/approvals?tab=%3Cscript%3E', 'Approvals')['tab']).toBeNull();
  });

  it('notes a chosen tab in the address as a new entry, without asking the server', () => {
    const props = open('/people/approvals', 'Approvals');
    const before = window.history.length;
    call(props, 'onTabChange', 'asked');
    expect(here()).toBe('/people/approvals?tab=asked');
    expect(window.history.length).toBe(before + 1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('rewrites the entry while a search is typed, and leaves an empty one out', () => {
    const props = open('/people/import-export?kind=export', 'ImportExport');
    expect(props['kind']).toBe('export');
    const before = window.history.length;
    call(props, 'onSearchChange', 'payroll');
    expect(here()).toBe('/people/import-export?kind=export&q=payroll');
    call(props, 'onSearchChange', '  ');
    expect(here()).toBe('/people/import-export?kind=export');
    expect(window.history.length).toBe(before);
  });

  it('leaves a default out of the address', () => {
    const props = open('/people/directory/org-chart?layout=horizontal&focus=p1', 'OrgChart');
    expect(props['layout']).toBe('horizontal');
    expect(props['focusId']).toBe('p1');
    call(props, 'onLayoutChange', 'vertical');
    call(props, 'onFocusChange', null);
    expect(here()).toBe('/people/directory/org-chart');
  });
});

describe('the directory, which People answers from the address', () => {
  it('hands the screen what the address asks for', () => {
    const props = open(
      '/people/directory/list?q=ada&filter=department:sales&sort=name:desc&group=department&incomplete=true',
      'Directory',
    );
    expect(props).toMatchObject({
      search: 'ada',
      filters: { department: 'sales' },
      group: 'department',
      incomplete: true,
      view: 'list',
    });
  });

  it('pushes a new order, back to the first page, and replaces while typing', () => {
    const props = open('/people/directory/list?q=ada&after=c2', 'Directory');
    call(props, 'onSortChange', { key: 'hire_date', direction: 'desc' });
    expect(router.push).toHaveBeenCalledWith('/people/directory/list?q=ada&sort=hire_date%3Adesc', {
      scroll: false,
    });
    call(props, 'onSearchChange', 'adam');
    expect(router.replace).toHaveBeenCalledWith('/people/directory/list?q=adam', {
      scroll: false,
    });
  });

  it('keeps the search and filters across views, but not the org chart’s own', () => {
    const props = open(
      '/people/directory/org-chart?q=ada&conditions=%5B%5D&focus=p1&layout=horizontal&after=c',
      'OrgChart',
    );
    call(props, 'onViewChange', 'cards');
    expect(router.push).toHaveBeenCalledWith('/people/directory/cards?q=ada&conditions=%5B%5D');
  });
});
