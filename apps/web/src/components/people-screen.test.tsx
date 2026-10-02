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
  markNotUnusual: vi.fn(),
  askAboutChange: vi.fn(),
  answerApprovalQuestion: vi.fn(),
  setApprovalCheck: vi.fn(),
  saveSegment: vi.fn(),
  directoryPage: vi.fn(),
}));
// The shell around the page: its data is what the page is remembered under.
const shell = vi.hoisted(() => ({
  current: {
    routes: [
      '/people/insights/headcount',
      '/people/insights/turnover',
      '/people/insights/what-changed',
    ],
    screens: {
      '/people/insights/headcount': 'ReportRuns',
      '/people/insights/turnover': 'ReportRuns',
      '/people/insights/what-changed': 'CountryPacks',
    },
  },
}));
vi.mock('./app-shell', () => ({ useShellData: () => shell.current }));
let shown: Record<string, unknown> = {};
vi.mock('./remote-screen', () => ({
  RemoteScreen: ({ props }: { props: Record<string, unknown> }) => {
    shown = props;
    return null;
  },
}));

const { PeopleScreen, heldFor } = await import('./people-screen');

/** The screen at `url`, and the props it was handed. */
function open(url: string, component: string): Record<string, unknown> {
  window.history.replaceState(null, '', url);
  render(
    <PeopleScreen
      route={{ entry: 'x', component }}
      load={{ status: 'ready', data: {} }}
      path={window.location.pathname}
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

  it('keeps the flagged tab and the open change in the address (MA6, MA7)', () => {
    const props = open('/people/approvals?tab=flagged&change=c1', 'Approvals');
    expect([props['tab'], props['change']]).toEqual(['flagged', 'c1']);
    call(props, 'onChangeOpen', 'c2');
    expect(here()).toBe('/people/approvals?tab=flagged&change=c2');
    call(props, 'onTabChange', 'decided');
    expect(here()).toBe('/people/approvals?tab=decided');
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

describe('a part of the page the server streams', () => {
  const draw = (data: Record<string, unknown>) => (
    <PeopleScreen
      route={{ entry: 'x', component: 'ImportExport' }}
      load={{ status: 'ready', data }}
      path="/people/import-export"
      params={{}}
      search={{}}
      today="2026-09-29"
    />
  );
  const history = () => (shown['load'] as { data: { canImport: boolean; history: unknown } }).data;

  it('is drawn as loading, the rest at once, then as it arrives; seen again, at once', async () => {
    let arrive: (value: unknown) => void = () => undefined;
    const coming = new Promise((resolve) => {
      arrive = resolve;
    });
    const data = { canImport: true, history: coming };
    render(draw(data));
    expect(history()).toEqual({ canImport: true, history: 'loading' });
    arrive({ items: [], next: null, paged: false });
    await vi.waitFor(() => {
      expect(history().history).toEqual({ items: [], next: null, paged: false });
    });
    cleanup();
    render(draw(data));
    expect(history().history).toEqual({ items: [], next: null, paged: false });
  });

  it('is left out when it fails, rather than loading for ever', async () => {
    render(draw({ history: Promise.reject(new Error('gone')) }));
    await vi.waitFor(() => {
      expect(history().history).toBeNull();
    });
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

describe('what a loading state shows of a page before it arrives', () => {
  const tabs = ['what-changed', 'headcount', 'turnover'].map((t) => ({
    href: `/people/insights/${t}`,
    label: t,
    current: t === 'headcount',
  }));
  const live = () =>
    render(
      <PeopleScreen
        // A screen with no actions of its own stands in for Insights.
        route={{ entry: 'x', component: 'ReportRuns' }}
        load={{ status: 'ready', data: { figures: 1 } }}
        path="/people/insights/headcount"
        params={{}}
        search={{}}
        today="2026-09-29"
        frame={{ section: 'Insights', tabs }}
      />,
    );
  const now = () => shell.current as unknown as Parameters<typeof heldFor>[2];
  const current = (held: ReturnType<typeof heldFor>) =>
    held?.input.frame?.tabs?.find((t) => t.current)?.label;

  it('draws another address of the screen on show from its data, as that page', () => {
    live();
    const held = heldFor('/people/insights/turnover', {}, now());
    expect(held?.pending).toBe(false);
    expect(held?.input.path).toBe('/people/insights/turnover');
    expect(held?.input.load).toEqual({ status: 'ready', data: { figures: 1 } });
    expect(current(held)).toBe('turnover');
    // Asked another question, it is not the same data.
    expect(heldFor('/people/insights/turnover', { segment: 's' }, now())?.pending).toBe(true);
  });

  it('keeps the page on show under another of its tabs, its body to come', () => {
    live();
    const held = heldFor('/people/insights/what-changed', {}, now());
    expect(held?.pending).toBe(true);
    expect(held?.input.path).toBe('/people/insights/headcount');
    expect(current(held)).toBe('what-changed');
  });

  it('shows a page seen before as it was, until a write', () => {
    live();
    cleanup();
    // Away from it, nothing is on show: only what was seen.
    expect(heldFor('/people/insights/what-changed', {}, now())).toBeNull();
    expect(heldFor('/people/insights/headcount', {}, now())?.input.path).toBe(
      '/people/insights/headcount',
    );
    // A write draws the shell again: everything seen before it is stale.
    shell.current = { ...shell.current };
    expect(heldFor('/people/insights/headcount', {}, now())).toBeNull();
  });
});
